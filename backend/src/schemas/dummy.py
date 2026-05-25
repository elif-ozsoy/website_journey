from typing import Optional

from pydantic import BaseModel


class TestData(BaseModel):
    some_text: Optional[str] = None
    random_number: Optional[str] = None
