import os
import asyncio
import logging
from dotenv import load_dotenv
from browser_use import Agent, Browser, ChatOpenAI
from langchain_core.globals import set_debug

set_debug(True)

# 1. Enable Live Logging to the terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

load_dotenv()

async def main():
    # 2. Setup the Browser to generate the Localhost Link
    # We keep headless=True but expose the debugging port
    browser = Browser(
        # cdp_url="ws://127.0.0.1:9222",
        headless=False,
        window_size={'width': 1280, 'height': 720},
        device_scale_factor=2.0,
    )

    # Output the link for the user
    print("\n" + "="*60)
    print("🌐 LIVE PREVIEW LINK GENERATED:")
    print("👉 Click here to watch: http://localhost:9222")
    print("="*60 + "\n")

    # 3. Setup LLM
    # llm = ChatOpenAI(
    #     model=os.getenv("NVIDIA_MODEL", "google/gemma-3-27b-it"),
    #     api_key=os.getenv("NVIDIA_API_KEY"),
    #     base_url="https://integrate.api.nvidia.com/v1/",
    #     timeout=180,
    # )

    llm = ChatOpenAI(
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"), 
        api_key=os.getenv("UNSLOTH_API_KEY"), # A dummy key is fine for local inference
        model=os.getenv("OLLAMA_MODEL") # e.g., "qwen3.5-7b" or whatever is loaded
    )

    task="Go to wikipedia.org and find the birth year of Mozart."

    # 4. Setup Agent with a multi-step task so you have time to watch
    agent = Agent(
        llm=llm,
        task=task,
        use_vision=True,
        browser=browser,
        save_conversation_path="/home/haroldas/XAIML/CipherCorgi/notebook_artifacts/chat_logs"
    )

    # Run the agent
    logger.info("Agent is starting...")
    result = await agent.run()

    # Open a text file in write mode ("w") with utf-8 encoding
    with open("agent_session_log.txt", "w", encoding="utf-8") as log_file:
        
        # The result object contains the full history of the session
        for step, action in enumerate(result.history):
            # Write the step header
            log_file.write(f"\n--- STEP {step} ---\n")
            
            # Write the state of the browser that was sent to the model
            log_file.write(f"DOM State Sent: {action.state.dom_items}\n")
            
            # Write the model's resulting thought process and chosen actions
            if action.model_output:
                log_file.write(f"Model Output: {action.model_output}\n")

    print("Logs successfully saved to agent_session_log.txt!")
    
    logger.info("Agent finished. Closing browser...")
    await browser.close()
    
    print("\n🎯 Final Result:\n", result)

if __name__ == "__main__":
    asyncio.run(main())