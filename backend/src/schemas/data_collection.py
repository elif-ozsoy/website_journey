from pydantic import BaseModel, HttpUrl


class TesterLinkRequest(BaseModel):
    url: HttpUrl
    label: str | None = None


class TesterLinkResponse(BaseModel):
    tester_link: str
    site_id: str


class SiteDetail(BaseModel):
    site_id: str
    slug: str
    tester_link: str
    label: str | None
    target_url: str
