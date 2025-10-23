# sniff_market_json_v3_debug.py
from playwright.sync_api import sync_playwright
import argparse
import json, re, unicodedata
from datetime import datetime, timezone
from contextlib import suppress

URL = "https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado"
PLAYER_API_BASE = "https://www.laligafantasymarca.com/api/v3/player"
PLAYER_API_COMPETITION = "laliga-fantasy"


FETCH_POINTS_HISTORY = False


def to_int(s: str | None) -> int:
    if s is None:
        return 0
    s = (str(s).strip()
         .replace("\xa0", " ")
         .replace(".", "")
         .replace("€", "")
         .replace(" ", "")
         .replace(",", ""))
    try:
        return int(s)
    except:
        return 0

def to_float(s: str | None) -> float | None:
    if s is None:
        return None
    cleaned = (str(s)
               .replace("\xa0", " ")
               .replace("%", "")
               .strip())
    if not cleaned:
        return None
    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    cleaned = re.sub(r"[^0-9.+-]", "", cleaned)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except:
        return None


def parse_points_value(value) -> float | None:
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except Exception:
            return None
    return to_float(value)


def parse_matchday(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            ivalue = int(float(value))
            return ivalue if ivalue > 0 else None
        except Exception:
            return None
    text = normalize_name_text(value)
    if not text:
        return None
    m = re.search(r"([0-9]{1,3})", text)
    if not m:
        return None
    try:
        ivalue = int(m.group(1))
        return ivalue if ivalue > 0 else None
    except Exception:
        return None


def dedupe_points_history(entries: list[dict]) -> list[dict]:
    if not entries:
        return []
    dedup: dict[int, dict] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        md = parse_matchday(
            entry.get("matchday")
            or entry.get("jornada")
            or entry.get("round")
            or entry.get("day")
            or entry.get("gw")
        )
        points = parse_points_value(
            entry.get("points")
            or entry.get("puntos")
            or entry.get("score")
            or entry.get("valor")
            or entry.get("value")
        )
        if md is None or points is None:
            continue
        dedup[md] = {"matchday": md, "points": points}
    return [dedup[k] for k in sorted(dedup.keys())]


def parse_points_history_payload(payload) -> list[dict]:
    results: list[dict] = []

    def add_entry(matchday, points):
        md = parse_matchday(matchday)
        pts = parse_points_value(points)
        if md is None or pts is None:
            return
        results.append({"matchday": md, "points": pts})

    def handle(obj):
        if obj is None:
            return
        if isinstance(obj, (int, float)):
            add_entry(len(results) + 1, obj)
            return
        if isinstance(obj, dict):
            lowered = {str(k).lower(): v for k, v in obj.items()}

            # Direct mapping jornada/puntos
            if any(k in lowered for k in ["matchday", "jornada", "round", "day", "gw"]) and any(
                k in lowered for k in ["points", "puntos", "score", "valor", "value"]
            ):
                md = next(
                    (lowered[k] for k in ["matchday", "jornada", "round", "day", "gw"] if k in lowered),
                    None,
                )
                pts = next(
                    (lowered[k] for k in ["points", "puntos", "score", "valor", "value"] if k in lowered),
                    None,
                )
                add_entry(md, pts)

            # Dictionaries where keys encode the jornada (ej: j1: 6)
            for key, value in lowered.items():
                m = re.match(r"(?:j|jor|jornada|gw|md)[_\-]?([0-9]{1,3})", key)
                if m:
                    add_entry(int(m.group(1)), value)

            # Nested history keys
            for key in [
                "historial",
                "history",
                "puntuaciones",
                "scores",
                "matchdays",
                "jornadas",
                "points",
                "values",
            ]:
                if key in lowered:
                    handle(lowered[key])
            return

        if isinstance(obj, (list, tuple)):
            for item in obj:
                handle(item)
            return

        if isinstance(obj, str):
            text = obj.strip()
            if not text:
                return
            for candidate in (text, text.replace("'", '"')):
                try:
                    parsed = json.loads(candidate)
                    handle(parsed)
                    return
                except Exception:
                    continue

            pattern = re.compile(
                r"(?:j(?:or(?:nada)?)?|gw|md|round)?\s*([0-9]{1,3})[^0-9+\-]*([-+]?\d+(?:[.,]\d+)?)",
                re.IGNORECASE,
            )
            matches = pattern.findall(text)
            if matches:
                for jornada, puntos in matches:
                    add_entry(int(jornada), puntos)
                return

            tokens = re.split(r"[|;,]", text)
            parsed_tokens = []
            for token in tokens:
                token = token.strip()
                if not token:
                    continue
                m = re.match(
                    r"(?:j(?:or(?:nada)?)?|gw|md|round)?\s*([0-9]{1,3})\s*[:\-]?\s*([-+]?\d+(?:[.,]\d+)?)",
                    token,
                    re.IGNORECASE,
                )
                if m:
                    parsed_tokens.append((int(m.group(1)), m.group(2)))
            for jornada, puntos in parsed_tokens:
                add_entry(jornada, puntos)

    handle(payload)
    return dedupe_points_history(results)


def gather_datasets(locator) -> list:
    try:
        return locator.evaluate(
            """
            (root) => {
              const entries = [];
              const queue = [root];
              const visited = new Set();
              while (queue.length) {
                const node = queue.shift();
                if (!node || visited.has(node)) continue;
                visited.add(node);
                if (node.dataset && Object.keys(node.dataset).length) {
                  entries.push({ ...node.dataset });
                }
                if (node.getAttributeNames) {
                  const attrs = {};
                  for (const name of node.getAttributeNames()) {
                    if (name.startsWith('data-')) {
                      attrs[name.slice(5)] = node.getAttribute(name);
                    }
                  }
                  if (Object.keys(attrs).length) {
                    entries.push(attrs);
                  }
                }
                for (const child of Array.from(node.children || [])) {
                  queue.push(child);
                }
              }
              return entries;
            }
            """,
        )
    except Exception:
        return []


def close_detail_modal(page):
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    selectors = [
        "button:has-text('Cerrar')",
        "button:has-text('Close')",
        "button.cerrar",
        "button.close",
        "div.modal button.btn",
        "div.modal-header button",
        "div.swal2-container button.swal2-close",
    ]
    for sel in selectors:
        try:
            btn = page.locator(sel).first
            if btn.is_visible():
                btn.click(timeout=1000)
                page.wait_for_timeout(200)
                break
        except Exception:
            continue


def collect_history_from_modal(modal) -> list[dict]:
    history: list[dict] = []
    for payload in gather_datasets(modal):
        history.extend(parse_points_history_payload(payload))
    if history:
        return dedupe_points_history(history)
    try:
        text = modal.inner_text(timeout=1000)
        history.extend(parse_points_history_payload(text))
    except Exception:
        pass
    return dedupe_points_history(history)


def fetch_points_history_via_api(page, pid, label: str | None = None) -> list[dict]:
    if pid is None:
        return []
    try:
        context = page.context
    except Exception:
        context = None
    if context is None:
        return []

    descriptor = f"ID {pid}" if label is None else f"{label} (ID {pid})"
    url = f"{PLAYER_API_BASE}/{pid}?competition={PLAYER_API_COMPETITION}"
    print(f"   ↳ Consultando historial vía API para {descriptor}…")
    try:
        response = context.request.get(url, timeout=10_000)
    except Exception as exc:
        print(f"   ↳ No se pudo acceder a la API para {descriptor}: {exc}")
        return []

    try:
        if not response.ok:
            print(
                f"   ↳ La API devolvió un estado {response.status} para {descriptor}."
            )
            return []
    except Exception:
        pass

    history: list[dict] = []
    try:
        payload = response.json()
        history.extend(parse_points_history_payload(payload))
    except Exception as exc:
        try:
            text = response.text()
        except Exception:
            text = None
        if text:
            history.extend(parse_points_history_payload(text))
        else:
            print(
                f"   ↳ No se pudo interpretar la respuesta de la API para {descriptor}: {exc}"
            )

    normalized = dedupe_points_history(history)
    if normalized:
        print(
            f"   ↳ Historial obtenido vía API para {descriptor}: {len(normalized)} jornadas."
        )
    return normalized


def fetch_points_history_via_modal(page, locator, pid, label: str | None = None) -> list[dict]:
    if label:
        descriptor = f"{label} (ID {pid})" if pid is not None else label
    elif pid is not None:
        descriptor = f"ID {pid}"
    else:
        descriptor = "el jugador"
    print(f"   ↳ Cargando historial de puntos para {descriptor}…")
    try:
        locator.scroll_into_view_if_needed(timeout=1000)
    except Exception:
        pass

    opened = False
    try:
        locator.click(timeout=1500)
        opened = True
    except Exception:
        pass

    if not opened and pid is not None:
        try:
            opened = page.evaluate(
                """
                (playerId) => {
                  const fn = window?.app?.Analytics?.showPlayerDetail
                    || window?.Analytics?.showPlayerDetail
                    || window?.showPlayerDetail;
                  if (typeof fn === 'function') {
                    try {
                      fn('laliga-fantasy', '', playerId);
                      return true;
                    } catch (err) {
                      console.warn('No se pudo ejecutar showPlayerDetail', err);
                    }
                  }
                  const card = Array.from(document.querySelectorAll('div.elemento_jugador'))
                    .find((el) => (el.getAttribute('onclick') || '').includes(String(playerId)));
                  if (card) {
                    card.click();
                    return true;
                  }
                  return false;
                }
                """,
                pid,
            )
        except Exception:
            opened = False

    if not opened:
        print(f"   ↳ No se pudo abrir el detalle para {descriptor}.")
        return []

    history: list[dict] = []
    try:
        modal = page.wait_for_selector(
            "div[id*='detalle'], div[class*='detalle'], div.modal, div[class*='player']",
            state="visible",
            timeout=4000,
        )
        page.wait_for_timeout(300)
        history = collect_history_from_modal(modal)
    except Exception:
        try:
            raw = page.evaluate(
                "() => window?.app?.Analytics?.playerDetail || window?.playerDetail || window?.detalleJugador || null"
            )
            history = parse_points_history_payload(raw)
        except Exception:
            history = []
    finally:
        close_detail_modal(page)
        try:
            page.wait_for_timeout(150)
        except Exception:
            pass

    return dedupe_points_history(history)


def compute_average_from_history(history: list[dict], last: int | None = None) -> float | None:
    if not history:
        return None
    if last is not None and last > 0:
        values = [item["points"] for item in history[-last:] if isinstance(item.get("points"), (int, float))]
    else:
        values = [item["points"] for item in history if isinstance(item.get("points"), (int, float))]
    if not values:
        return None
    return sum(values) / len(values)


def compute_total_points(history: list[dict]) -> float | None:
    if not history:
        return None
    values = [item["points"] for item in history if isinstance(item.get("points"), (int, float))]
    if not values:
        return None
    return float(sum(values))

def normalize_name_text(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", str(text).replace("\xa0", " ")).strip()


def dedupe_double_text(text: str | None) -> str:
    """
    Arregla nombres repetidos consecutivos:
    - 'Pau LópezPau López' -> 'Pau López'
    - 'Pau López Pau López' -> 'Pau López'
    - Soporta cualquier cadena duplicada exacta (con o sin espacio entre bloques).
    """
    s = normalize_name_text(text)
    # Caso 1: duplicado sin separador (A + A)
    if len(s) % 2 == 0:
        half = len(s) // 2
        if s[:half] == s[half:]:
            return s[:half].strip()
    # Caso 2: duplicado con espacios entre bloques (A + ' ' + A)
    m = re.match(r'^(.*)\s+\1$', s)
    if m:
        return m.group(1).strip()
    return s


def dedupe_repeated_words(text: str | None) -> str:
    s = normalize_name_text(text)
    if not s:
        return ""
    cleaned = []
    for part in s.split(" "):
        if cleaned and part.lower() == cleaned[-1].lower():
            continue
        cleaned.append(part)
    return " ".join(cleaned)


def _is_lower_letter(ch: str) -> bool:
    return ch.isalpha() and ch == ch.lower()


def _is_upper_letter(ch: str) -> bool:
    return ch.isalpha() and ch == ch.upper()


def split_camel_chunk(chunk: str) -> list[str]:
    if not chunk:
        return []
    result: list[str] = []
    current = ""
    for idx, char in enumerate(chunk):
        if idx > 0 and _is_upper_letter(char) and _is_lower_letter(chunk[idx - 1]) and len(current) >= 3:
            result.append(current)
            current = char
        else:
            current += char
    if current:
        result.append(current)
    return result


def tokenize_name(text: str | None) -> list[str]:
    base = normalize_name_text(text)
    if not base:
        return []
    tokens: list[str] = []
    matcher = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9.'’-]+|[^\s]+")
    for raw in base.split():
        for part in split_camel_chunk(raw):
            matches = matcher.findall(part)
            if matches:
                tokens.extend(matches)
            else:
                tokens.append(part)
    return tokens


def dedupe_trailing_tokens(text: str | None) -> str:
    tokens = tokenize_name(text)
    if not tokens:
        return ""

    def normalize_token(token: str) -> str:
        base = unicodedata.normalize("NFD", token)
        base = re.sub(r"[\u0300-\u036f]", "", base)
        return re.sub(r"[\s.'’´`-]", "", base).casefold()

    deduped: list[str] = []
    last_norm: str | None = None
    for token in tokens:
        norm = normalize_token(token)
        if norm and norm == last_norm:
            continue
        deduped.append(token)
        last_norm = norm

    end = len(deduped)
    while end > 0:
        token = deduped[end - 1]
        norm = normalize_token(token)
        if not norm:
            end -= 1
            continue
        preceding = [normalize_token(t) for t in deduped[: end - 1]]
        if norm in preceding:
            end -= 1
            continue
        if len(norm) <= 2 and any(p.startswith(norm) for p in preceding):
            end -= 1
            continue
        break

    return " ".join(deduped[:end])


def dedupe_repeated_suffix(text: str | None) -> str:
    """
    Elimina repeticiones consecutivas del bloque final aunque no exista un separador.

    Casos:
      - "Pau CubarsíCubarsí" -> "Pau Cubarsí"
      - "Paulo GazzanigaGazzaniga" -> "Paulo Gazzaniga"
      - "Robin Le NormandLe Normand" -> "Robin Le Normand"

    Se ignoran duplicados triviales (p.ej. "Lala") al exigir bloques de tamaño
    razonable o con mayúsculas/espacios.
    """

    s = normalize_name_text(text)
    if not s:
        return ""

    def is_candidate_chunk(chunk: str) -> bool:
        if len(chunk.strip()) < 3:
            return False
        if any(c.isupper() for c in chunk):
            return True
        if any(sep in chunk for sep in [" ", "-", "'", "’"]):
            return True
        return False

    while True:
        lowered = s.casefold()
        found = False
        for size in range(len(s) // 2, 0, -1):
            chunk = s[-size:]
            if not is_candidate_chunk(chunk):
                continue
            suffix = lowered[-size:]
            if lowered.endswith(suffix * 2):
                s = s[:-size].rstrip()
                found = True
                break
        if not found:
            break

    return normalize_name_text(s)


def clean_name_candidate(text: str | None) -> str:
    return dedupe_trailing_tokens(
        dedupe_repeated_suffix(
            dedupe_repeated_words(
                dedupe_double_text(text)
            )
        )
    )


def load_existing_market_payload(path: str = "market.json") -> dict | None:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except Exception as exc:
        print(f"⚠️  No se pudo leer {path}: {exc}")
        return None


def _build_player_indexes(players: list[dict]) -> tuple[dict, dict]:
    by_id: dict = {}
    by_name: dict = {}
    for idx, entry in enumerate(players or []):
        if not isinstance(entry, dict):
            continue
        pid = entry.get("id")
        if pid is not None:
            pid_str = str(pid).strip()
            if pid_str:
                by_id[pid_str] = idx
                with suppress(Exception):
                    by_id[int(pid_str)] = idx
        name_key = clean_name_candidate(entry.get("name"))
        if name_key:
            by_name[name_key.casefold()] = idx
    return by_id, by_name


def merge_player_payload(existing_players: list[dict] | None, updates: list[dict] | None) -> tuple[list[dict], int]:
    base = list(existing_players or [])
    if not updates:
        return base, 0

    by_id, by_name = _build_player_indexes(base)
    updated = 0

    for entry in updates:
        if not isinstance(entry, dict):
            continue
        idx = None
        pid = entry.get("id")
        pid_str = str(pid).strip() if pid is not None else ""
        if pid_str and pid_str in by_id:
            idx = by_id[pid_str]
        else:
            try:
                pid_int = int(pid)
            except Exception:
                pid_int = None
            if pid_int is not None and pid_int in by_id:
                idx = by_id[pid_int]

        if idx is None:
            name_key = clean_name_candidate(entry.get("name"))
            if name_key:
                idx = by_name.get(name_key.casefold())

        if idx is not None:
            merged = dict(base[idx])
            merged.update(entry)
            base[idx] = merged
        else:
            base.append(entry)
            idx = len(base) - 1

        if pid_str:
            by_id[pid_str] = idx
            with suppress(Exception):
                by_id[int(pid_str)] = idx
        name_key = clean_name_candidate(entry.get("name"))
        if name_key:
            by_name[name_key.casefold()] = idx
        updated += 1

    return base, updated


def extract_points_history(page, locator, pid, label: str | None = None) -> list[dict]:
    history: list[dict] = []
    try:
        attr_names = locator.evaluate("el => el.getAttributeNames()") or []
    except Exception:
        attr_names = []

    for name in attr_names:
        if not name or not name.startswith("data-"):
            continue
        lowered = name.lower()
        if not any(keyword in lowered for keyword in ["punto", "point", "jorn", "match", "score"]):
            continue
        try:
            value = locator.get_attribute(name)
        except Exception:
            value = None
        if not value:
            continue
        history.extend(parse_points_history_payload(value))

    for payload in gather_datasets(locator):
        history.extend(parse_points_history_payload(payload))

    attr_history = dedupe_points_history(history)
    fallback_history = attr_history or []

    if attr_history:
        if not FETCH_POINTS_HISTORY:
            return attr_history
        max_matchday = 0
        try:
            max_matchday = max(
                int(float(entry.get("matchday", 0)))
                if isinstance(entry, dict)
                else 0
                for entry in attr_history
            )
        except Exception:
            max_matchday = 0
        if len(attr_history) > 1 or max_matchday > 1:
            return attr_history
    else:
        if not FETCH_POINTS_HISTORY:
            return []

    api_history = fetch_points_history_via_api(page, pid, label)
    if api_history:
        return api_history

    if pid is None:
        return fallback_history

    detail_history = fetch_points_history_via_modal(page, locator, pid, label)
    if detail_history:
        return detail_history

    return fallback_history


def maybe_accept_cookies(page):
    sels = [
        "button:has-text('Aceptar')",
        "button:has-text('Acepto')",
        "button:has-text('De acuerdo')",
        "button:has-text('Agree')",
        "div[role='dialog'] button:has-text('Aceptar')",
    ]
    for sel in sels:
        try:
            btn = page.locator(sel).first
            if btn.is_visible():
                print("→ Aceptando cookies…")
                btn.click(timeout=1000)
                page.wait_for_timeout(400)
                break
        except:
            pass

def extract_all(page, target_ids: list[int] | None = None, target_names: list[str] | None = None):
    # Lee TODOS los jugadores del contenedor (aunque algunos estén ocultos por paginación client-side)
    page.wait_for_selector("div.lista_elementos div.elemento_jugador", timeout=90_000)
    cards = page.locator("div.lista_elementos div.elemento_jugador")
    n = cards.count()
    print(f"🔍 Detectados {n} elementos .elemento_jugador")

    players = []
    history_cache: dict[int, list[dict]] = {}

    target_id_set: set[int] = set()
    if target_ids:
        for raw in target_ids:
            if raw is None:
                continue
            try:
                target_id_set.add(int(raw))
            except Exception:
                try:
                    target_id_set.add(int(str(raw).strip()))
                except Exception:
                    continue

    target_name_keys: set[str] = set()
    if target_names:
        for raw in target_names:
            if not raw:
                continue
            key = clean_name_candidate(raw)
            if key:
                target_name_keys.add(key.casefold())

    filtering = bool(target_id_set or target_name_keys)
    remaining_ids = set(target_id_set)
    remaining_names = set(target_name_keys)
    for i in range(n):
        el = cards.nth(i)

        # ID del jugador si viene en el onclick: app.Analytics.showPlayerDetail('laliga-fantasy','',8405);
        onclick = el.get_attribute("onclick") or ""
        m = re.search(r",\s*([0-9]+)\s*\)\s*;", onclick)
        pid = int(m.group(1)) if m else None

        matches_filter = True
        matched_by_id = False
        matched_by_name = False
        normalized_name_key = ""
        if filtering:
            matches_filter = False
            if pid is not None and pid in remaining_ids:
                matches_filter = True
                matched_by_id = True

        def ga(name):
            try:
                return el.get_attribute(name)
            except:
                return None

        def grab_first(*names):
            for name in names:
                value = ga(name)
                if value:
                    return value
            return None

        # Nombre visible (puede venir duplicado visualmente):
        try:
            # Cogemos TODO el bloque del nombre para evitar dobles fuentes internas
            raw_name_visible = el.locator(".datos-nombre").inner_text()
        except:
            raw_name_visible = ""
        raw_name_attr = ga("data-nombre") or ga("data-name")
        clean_visible = clean_name_candidate(raw_name_visible)
        clean_attr = clean_name_candidate(raw_name_attr)
        clean_name = clean_attr or clean_visible
        if not clean_name:
            clean_name = clean_visible or clean_attr
        if clean_attr and clean_visible and clean_attr.lower() != clean_visible.lower():
            print(
                "⚠️  data-nombre distinto del texto visible:",
                f"'{clean_attr}' vs '{clean_visible}'",
            )
        if re.search(r"(\b\w+\b)\s+\1", clean_name or "", flags=re.IGNORECASE):
            print("⚠️  Posible repetición en nombre normalizado:", clean_name)

        if filtering and not matches_filter:
            name_key_candidate = clean_name_candidate(clean_name)
            normalized_name_key = (
                name_key_candidate.casefold() if name_key_candidate else ""
            )
            if (
                normalized_name_key
                and normalized_name_key in remaining_names
            ):
                matches_filter = True
                matched_by_name = True

        if filtering and not matches_filter:
            continue

        # Equipo visible
        try:
            team_vis = el.locator(".equipo span").inner_text().strip()
        except:
            team_vis = ""

        data = {
            "id": pid,
            "name": clean_name,
            "team_id": (ga("data-equipo") or "").strip(),
            "team": team_vis,
            "position": (ga("data-posicion") or "").strip(),
            "value": to_int(ga("data-valor")),
        }

        avg_points_attr = grab_first(
            "data-media",
            "data-media-total",
            "data-media_jornada",
            "data-mediajornada",
            "data-mediajornadas",
            "data-media-puntos",
            "data-promedio",
            "data-puntos",
        )
        recent_points_attr = grab_first(
            "data-media5",
            "data-media-5",
            "data-media5partidos",
            "data-media5p",
            "data-media_reciente",
            "data-media-reciente",
            "data-mediaultimos5",
            "data-media-ultimos5",
            "data-ultimos5",
            "data-ult5",
            "data-puntos5",
        )
        total_points_attr = grab_first(
            "data-puntos-total",
            "data-puntos_total",
            "data-puntos-totales",
            "data-puntos_totales",
            "data-total-puntos",
            "data-total_puntos",
            "data-totalpuntos",
            "data-puntos-temporada",
            "data-puntos-season",
            "data-puntos_temporada",
        )

        data["points_avg"] = to_float(avg_points_attr)
        data["points_last5"] = to_float(recent_points_attr)
        data["points_total"] = to_float(total_points_attr)

        if pid is not None and pid in history_cache:
            history = history_cache[pid]
        else:
            history = extract_points_history(page, el, pid, clean_name)
            if pid is not None:
                history_cache[pid] = history
        data["points_history"] = history

        if data["points_avg"] is None:
            avg_from_history = compute_average_from_history(history)
            if avg_from_history is not None:
                data["points_avg"] = avg_from_history

        if data["points_last5"] is None:
            recent_from_history = compute_average_from_history(history, last=5)
            if recent_from_history is not None:
                data["points_last5"] = recent_from_history

        if data["points_total"] is None:
            total_from_history = compute_total_points(history)
            if total_from_history is not None:
                data["points_total"] = total_from_history

        # Debug de lectura por jugador
        val_fmt = f"{data['value']:,}".replace(",", ".")
        print(f"→ Jugador {i+1}/{n}: {data['name']} ({data['team']}) | {val_fmt} €")

        # Añadir históricos y variaciones
        for k in [1, 2, 3, 7, 14, 30]:
            data[f"value_{k}"] = to_int(ga(f"data-valor{k}"))
            data[f"diff_{k}"] = to_int(ga(f"data-diferencia{k}"))
            pct_raw = ga(f"data-diferencia-pct{k}") or "0"
            try:
                data[f"diff_pct_{k}"] = float(pct_raw.replace(",", "."))
            except:
                data[f"diff_pct_{k}"] = 0.0

        players.append(data)

        if filtering:
            if matched_by_id and pid is not None:
                with suppress(Exception):
                    remaining_ids.discard(int(pid))
            if normalized_name_key:
                remaining_names.discard(normalized_name_key)
            if not remaining_ids and not remaining_names:
                break

    if filtering:
        print(f"✅ Lectura completa: {len(players)} jugadores extraídos (filtrado).")
    else:
        print(f"✅ Lectura completa: {len(players)} jugadores extraídos.")
    return players

def main():
    parser = argparse.ArgumentParser(
        description="Genera market.json a partir del mercado web de FutbolFantasy"
    )
    parser.add_argument(
        "--mode",
        choices=["market", "points"],
        default="market",
        help=(
            "Selecciona 'market' para capturar solo valores de mercado o 'points' "
            "para capturar también los historiales de puntos"
        ),
    )
    parser.add_argument(
        "--player-id",
        dest="player_ids",
        action="append",
        help="ID numérico del jugador a actualizar (puede repetirse).",
    )
    parser.add_argument(
        "--player-name",
        dest="player_names",
        action="append",
        help="Nombre aproximado del jugador a actualizar (opcional).",
    )
    parser.add_argument(
        "--headless",
        dest="headless",
        action="store_true",
        help="Ejecuta el navegador en modo headless",
    )
    parser.add_argument(
        "--no-headless",
        dest="headless",
        action="store_false",
        help="Fuerza el modo visible del navegador",
    )
    parser.set_defaults(headless=False)
    args = parser.parse_args()

    target_ids: list[int] = []
    if getattr(args, "player_ids", None):
        for raw in args.player_ids:
            if raw is None:
                continue
            try:
                target_ids.append(int(str(raw).strip()))
            except Exception:
                print(f"⚠️  ID de jugador no válido ignorado: {raw}")

    target_names: list[str] = []
    if getattr(args, "player_names", None):
        for raw in args.player_names:
            if not raw:
                continue
            target_names.append(str(raw))

    filtering = bool(target_ids or target_names)

    global FETCH_POINTS_HISTORY
    FETCH_POINTS_HISTORY = args.mode == "points"

    if FETCH_POINTS_HISTORY:
        print(
            "🔁 Modo puntos: se capturará el historial de puntuaciones de cada jugador."
        )
    else:
        print(
            "ℹ️ Modo mercado: se omite la lectura detallada del historial de puntuaciones."
        )

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=args.headless)
            ctx = None
            page = None
            try:
                ctx = browser.new_context()
                page = ctx.new_page()

                print(f"🌐 Abriendo {URL} …")
                page.goto(URL, wait_until="domcontentloaded", timeout=90_000)
                maybe_accept_cookies(page)

                page.wait_for_selector("div.lista_elementos", timeout=90_000)
                players = extract_all(
                    page,
                    target_ids=target_ids if target_ids else None,
                    target_names=target_names if target_names else None,
                )
            finally:
                if page is not None:
                    with suppress(Exception):
                        page.close()
                if ctx is not None:
                    with suppress(Exception):
                        ctx.close()
                with suppress(Exception):
                    browser.close()
    except Exception:
        raise

    timestamp = datetime.now(timezone.utc).isoformat()

    if filtering:
        existing_payload = load_existing_market_payload() or {}
        existing_players = (
            existing_payload.get("players")
            if isinstance(existing_payload, dict)
            and isinstance(existing_payload.get("players"), list)
            else []
        )
        merged_players, updated_count = merge_player_payload(existing_players, players)

        if not merged_players and not updated_count and not existing_players:
            print(
                "⚠️  No se encontraron jugadores con los criterios indicados y no existe un market.json previo."
            )
            return

        payload = dict(existing_payload) if isinstance(existing_payload, dict) else {}
        payload["players"] = merged_players
        payload["count"] = len(merged_players)
        payload["updated_at"] = timestamp
        payload["mode"] = args.mode

        if updated_count:
            print(f"💾 Actualizados {updated_count} jugadores en market.json.")
        else:
            print("ℹ️ No se modificó ningún jugador con los criterios indicados.")
    else:
        payload = {
            "updated_at": timestamp,
            "count": len(players),
            "players": players,
            "mode": args.mode,
        }
    with open("market.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"💾 market.json guardado con {payload['count']} jugadores.")

if __name__ == "__main__":
    main()
