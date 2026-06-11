
from pydantic import BaseModel


class TestData(BaseModel):
    some_text: str | None = None
    random_number: str | None = None
