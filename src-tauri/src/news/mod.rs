use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub published_at: i64,
    pub url: Option<String>,
}

/// Placeholder news source. Swap this for a real fetch against your own
/// backend/CMS (e.g. `https://api.soulclient.example/news`) once available;
/// the frontend's Home page already renders an empty state gracefully.
pub fn fetch_news() -> Vec<NewsItem> {
    Vec::new()
}
