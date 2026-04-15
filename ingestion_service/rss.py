from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

import httpx

STRIP_TAGS = re.compile(r"<[^>]+>")


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return html.unescape(el.text.strip())


def _flatten_description(raw: str) -> str:
    if not raw:
        return ""
    t = html.unescape(STRIP_TAGS.sub(" ", raw))
    t = re.sub(r"\s+", " ", t).strip()
    return t[:2000]


@dataclass(frozen=True)
class FetchOutcome:
    source_id: str
    display_name: str
    feed_url: str
    ok: bool
    error: str | None
    items: list[dict[str, Any]]


def parse_rss_xml(xml_text: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    items_out: list[dict[str, Any]] = []

    channel = root
    if _local_name(root.tag).lower() == "rss":
        channel = root.find("{*}channel") or root.find("channel")
    elif _local_name(root.tag).lower() == "feed":
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns) or root.findall("{http://www.w3.org/2005/Atom}entry"):
            title_el = entry.find("atom:title", ns) or entry.find("{http://www.w3.org/2005/Atom}title")
            link_el = entry.find("atom:link", ns) or entry.find("{http://www.w3.org/2005/Atom}link")
            summary_el = entry.find("atom:summary", ns) or entry.find("{http://www.w3.org/2005/Atom}summary")
            content_el = entry.find("atom:content", ns) or entry.find("{http://www.w3.org/2005/Atom}content")
            updated_el = entry.find("atom:updated", ns) or entry.find("{http://www.w3.org/2005/Atom}updated")
            href = ""
            if link_el is not None:
                href = (link_el.get("href") or "").strip()
            title = _text(title_el)
            summary = _text(summary_el) or _text(content_el)
            items_out.append(
                {
                    "title": title,
                    "link": href,
                    "summary": _flatten_description(summary),
                    "published": _text(updated_el),
                }
            )
        return items_out

    if channel is None:
        return items_out

    for item in channel.findall("{*}item") + channel.findall("item"):
        title_el = None
        link_el = None
        desc_el = None
        pub_el = None
        for child in list(item):
            ln = _local_name(child.tag).lower()
            if ln == "title":
                title_el = child
            elif ln == "link":
                link_el = child
            elif ln in ("description", "summary"):
                desc_el = child
            elif ln == "pubdate":
                pub_el = child
        title = _text(title_el)
        link = _text(link_el)
        summary = ""
        if desc_el is not None and (desc_el.text or ""):
            summary = _flatten_description(desc_el.text or "")
        elif desc_el is not None:
            summary = _flatten_description("".join(desc_el.itertext()))
        items_out.append(
            {
                "title": title,
                "link": link,
                "summary": summary,
                "published": _text(pub_el),
            }
        )

    return items_out


async def fetch_feed(
    client: httpx.AsyncClient,
    *,
    source_id: str,
    display_name: str,
    feed_url: str,
    timeout_sec: float,
) -> FetchOutcome:
    try:
        r = await client.get(feed_url, timeout=timeout_sec)
        r.raise_for_status()
        items = parse_rss_xml(r.text)
        return FetchOutcome(
            source_id=source_id,
            display_name=display_name,
            feed_url=feed_url,
            ok=True,
            error=None,
            items=items,
        )
    except Exception as e:  # noqa: BLE001 — boundary: return degraded bundle
        msg = str(e).strip() or type(e).__name__
        return FetchOutcome(
            source_id=source_id,
            display_name=display_name,
            feed_url=feed_url,
            ok=False,
            error=msg[:500],
            items=[],
        )
