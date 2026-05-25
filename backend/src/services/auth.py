import secrets
import uuid

from sqlalchemy.orm import Session

from models.user import User
from models.user_token import UserToken


def register(db: Session, username: str, password: str, email: str | None = None) -> tuple[User, str]:
    if db.query(User).filter(User.username == username).first():
        raise ValueError("Username already taken")
    if email and db.query(User).filter(User.email == email).first():
        raise ValueError("Email already registered")

    user = User(id=str(uuid.uuid4()), username=username, email=email or None)
    user.set_password(password)
    db.add(user)
    db.flush()

    token = _create_token(db, user.id)
    db.commit()
    db.refresh(user)
    return user, token


def login(db: Session, username: str, password: str) -> tuple[User, str]:
    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.verify_password(password):
        raise ValueError("Invalid username or password")

    token = _create_token(db, user.id)
    db.commit()
    return user, token


def identify_or_create(db: Session, name: str, email: str) -> tuple[User, str]:
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(id=str(uuid.uuid4()), username=email[:64], email=email)
        user.set_password(secrets.token_urlsafe(32))
        db.add(user)
        db.flush()

    token = _create_token(db, user.id)
    db.commit()
    db.refresh(user)
    return user, token


def get_user_by_token(db: Session, token: str) -> User | None:
    row = db.query(UserToken).filter(UserToken.token == token).first()
    if row is None:
        return None
    return db.get(User, row.user_id)


def _create_token(db: Session, user_id: str) -> str:
    token = secrets.token_urlsafe(48)
    db.add(UserToken(token=token, user_id=user_id))
    return token
