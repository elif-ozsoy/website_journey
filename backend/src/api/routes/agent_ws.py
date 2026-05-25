import asyncio
import json
import sys
import threading
import traceback
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import services.journeys as journey_svc
import services.policy as policy_svc
import services.tasks as task_svc
from db.session import SessionLocal
from services.agent_runner import run_browser_agent
from services.journeys import persist_browseruse_screenshots
from services.attention import annotate_attention_background
from services.solution_eval import evaluate_solution
import services.auth as auth_svc

router = APIRouter(tags=["Agent"])


@router.websocket("/ws/run")
async def websocket_run(websocket: WebSocket):
    await websocket.accept()
    print(f"[WS] Connection accepted from {websocket.client}", flush=True, file=sys.stderr)
    try:
        print("[WS] Waiting for config message...", flush=True, file=sys.stderr)
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
        print(f"[WS] Received raw text ({len(raw)} bytes): {raw[:200]}", flush=True, file=sys.stderr)
        config = json.loads(raw)

        url = str(config.get("url", "")).strip()
        task = str(config.get("task", "")).strip()
        llm_provider = str(config.get("llm_provider", "nvidia")).strip() or "nvidia"
        api_key = str(config.get("api_key", "")).strip()
        model = config.get("model") or None
        site_id = config.get("site_id") or None
        task_id = config.get("task_id") or None
        user_token = config.get("user_token") or None
        use_policy = bool(config.get("use_policy", False))
        # run_mode: 'human_policy' uses events from human sessions (default)
        #           'ai_policy'    uses steps from stored AI agent journeys
        run_mode = str(config.get("run_mode", "human_policy")).strip() or "human_policy"

        needs_api_key = llm_provider not in {"local"}
        if not url or not task or (needs_api_key and not api_key):
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "url and task are required. api_key is required for non-local providers.",
                }
            )
            return

        original_task = task  # preserve before policy augmentation

        # Build behavioral policy when requested
        policy: dict = {}
        if use_policy and site_id:
            try:
                db = SessionLocal()
                try:
                    if run_mode == "ai_policy":
                        policy = policy_svc.build_ai_policy(site_id, db)
                    else:
                        policy = policy_svc.build_policy(site_id, db)
                finally:
                    db.close()
            except Exception:
                pass  # degrade gracefully — run without policy if it fails

        policy_system_ext: str | None = None
        if policy:
            full_policy_block = policy_svc.generate_full_policy_prompt(policy)
            task = (
                f"{task}\n\n"
                f"IMPORTANT: Behave like the average human user.\n\n"
                f"{full_policy_block}"
            )
            policy_system_ext = (
                "\n\n"
                "# POLICY BOT AMENDMENTS — apply these as extensions to each named section:\n\n"
                "<intro>\n"
                "7. Following the trend of the provided human journeys, even if this means that the task may be completed slower or not completed at all\n"
                "</intro>\n\n"
                "<input>\n"
                "6. <human_behavioral_policy>: Trends of human journeys, which you need to follow. "
                "This block describes how real users interact with the site and must guide every action you take.\n"
                "</input>\n\n"
                "<browser_rules>\n"
                "- STRICTLY follow the human journey trends provided in <human_behavioral_policy>. "
                "Your actions must mirror the most common human behavior patterns shown there, "
                "even if this results in a slower path or the task not being fully completed.\n"
                "</browser_rules>\n\n"
                "<planning>\n"
                "- When creating or revising a plan, always prioritise actions that align with the human journey trends "
                "in <human_behavioral_policy>. Adherence to human journey trends takes priority over optimal task completion.\n"
                "</planning>\n\n"
                "<critical_reminders>\n"
                "13. ALWAYS follow the human journey trends provided in <human_behavioral_policy> — "
                "human journey adherence takes priority over task efficiency or completion speed.\n"
                "</critical_reminders>"
            )

        xai_trace: list[dict] = []
        step_counter = 0

        async def step_callback(step_data: dict):
            nonlocal step_counter
            step_counter += 1
            if policy:
                entry = policy_svc.build_xai_trace_entry(step_counter, step_data, policy)
                xai_trace.append(entry)
            try:
                await websocket.send_json({"type": "step", "data": step_data})
            except Exception:
                pass

        async def status_callback(message: str):
            try:
                await websocket.send_json({"type": "status", "message": message})
            except Exception:
                pass

        result = await run_browser_agent(
            url=url,
            task=task,
            llm_provider=llm_provider,
            api_key=api_key,
            model=model,
            step_callback=step_callback,
            status_callback=status_callback,
            extend_system_message=policy_system_ext,
        )

        if xai_trace:
            result["xai_trace"] = xai_trace

        print(f"site_id={site_id} - run complete with {len(result.get('steps', []))} steps, sending result", flush=True, file=sys.stderr)

        # Persist journey to DB if site_id provided
        if site_id and result.get("steps"):
            try:
                db = SessionLocal()
                try:
                    from models.site import Site as SiteModel
                    if not db.get(SiteModel, site_id):
                        print(f"[WS] site_id={site_id!r} not found in DB — skipping journey persistence", flush=True, file=sys.stderr)
                    else:
                        user_id = None
                        if user_token:
                            user = auth_svc.get_user_by_token(db, user_token)
                            user_id = user.id if user else None
                            if user_id is None:
                                print(f"Warning: user_token provided but lookup failed: {user_token[:20] if user_token else 'None'}...", flush=True, file=sys.stderr)
                        if use_policy:
                            if run_mode == "ai_policy":
                                journey_source = "policy_bot_ai"
                            else:
                                journey_source = "policy_bot_human"
                        else:
                            journey_source = "agent"
                        journey = journey_svc.upsert_journey(
                            db,
                            site_id=site_id,
                            task_title=original_task,
                            steps=result["steps"],
                            policy_trace=xai_trace if xai_trace else None,
                            user_id=user_id,
                            task_id=int(task_id) if task_id else None,
                            source=journey_source,
                        )
                        persist_browseruse_screenshots(db, journey, site_id, result["steps"])
                        threading.Thread(
                            target=annotate_attention_background,
                            args=(journey.id, api_key, llm_provider),
                            daemon=True,
                        ).start()

                        # ── Solution evaluation ──────────────────────────────
                        solution_eval_result = None
                        terminal = result["steps"][-1] if result.get("steps") else None
                        if (
                            terminal
                            and terminal.get("action_type") == "done"
                            and terminal.get("outcome") == "success"
                            and task_id
                        ):
                            try:
                                task_obj = task_svc.get_task(db, int(task_id))
                                expected = task_obj.expected_solution if task_obj else None
                                if expected:
                                    agent_answer = str(
                                        terminal.get("action_details", {}).get("text") or ""
                                    ).strip()
                                    if agent_answer:
                                        solution_eval_result = await asyncio.wait_for(
                                            asyncio.get_event_loop().run_in_executor(
                                                None,
                                                evaluate_solution,
                                                agent_answer,
                                                expected,
                                                api_key,
                                                llm_provider,
                                            ),
                                            timeout=6.0,
                                        )
                                        if solution_eval_result:
                                            import json as _json
                                            journey.solution_eval = _json.dumps({
                                                **solution_eval_result,
                                                "expected_solution": expected,
                                                "agent_answer": agent_answer[:500],
                                            })
                                            db.commit()
                            except Exception:
                                pass  # never block the WS response

                        if solution_eval_result:
                            result["solution_eval"] = solution_eval_result

                finally:
                    db.close()
            except Exception as exc:
                traceback.print_exc()
                pass  # never fail the WS response due to persistence error

        await websocket.send_json({"type": "complete", "data": result})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(),
                }
            )
        except Exception:
            pass
