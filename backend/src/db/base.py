from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import all models here so Base.metadata knows about them when init_db runs.
import models.event  # noqa: E402, F401
import models.screenshot  # noqa: E402, F401
import models.journey  # noqa: E402, F401
import models.session  # noqa: E402, F401
import models.site  # noqa: E402, F401
import models.user  # noqa: E402, F401
import models.user_token  # noqa: E402, F401
