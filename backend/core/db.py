from sqlmodel import create_engine, SQLModel, Session
from .config import settings

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    echo=True, # Echo SQL queries for debugging
)

# Register SQLAlchemy event listeners
import models.listeners

def get_session():
    with Session(engine) as session:
        yield session
