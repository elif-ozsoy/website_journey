from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import services.auth as svc
from api.deps import get_current_user, get_db
from models.user import User
from schemas.auth import AuthResponse, IdentifyRequest, LoginRequest, RegisterRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/identify", response_model=AuthResponse)
def identify(body: IdentifyRequest, db: Session = Depends(get_db)):
    user, token = svc.identify_or_create(db, body.name, body.email)
    return AuthResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    try:
        user, token = svc.register(db, body.username, body.password, body.email)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AuthResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    try:
        user, token = svc.login(db, body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return AuthResponse(access_token=token, user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)
