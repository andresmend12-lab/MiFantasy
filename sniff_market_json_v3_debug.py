# sniff_market_json_v3_debug.py
from playwright.sync_api import sync_playwright
import json, re
from datetime import datetime, timezone

URL = "https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado"


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
    return dedupe_repeated_suffix(
        dedupe_repeated_words(
            dedupe_double_text(text)
        )
    )

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

def extract_all(page):
    # Lee TODOS los jugadores del contenedor (aunque algunos estén ocultos por paginación client-side)
    page.wait_for_selector("div.lista_elementos div.elemento_jugador", timeout=90_000)
    cards = page.locator("div.lista_elementos div.elemento_jugador")
    n = cards.count()
    print(f"🔍 Detectados {n} elementos .elemento_jugador")

    players = []
    for i in range(n):
        el = cards.nth(i)

        # ID del jugador si viene en el onclick: app.Analytics.showPlayerDetail('laliga-fantasy','',8405);
        onclick = el.get_attribute("onclick") or ""
        m = re.search(r",\s*([0-9]+)\s*\)\s*;", onclick)
        pid = int(m.group(1)) if m else None

        def ga(name):
            try:
                return el.get_attribute(name)
            except:
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

    print(f"✅ Lectura completa: {len(players)} jugadores extraídos.")
    return players

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()

        print(f"🌐 Abriendo {URL} …")
        page.goto(URL, wait_until="domcontentloaded", timeout=90_000)
        maybe_accept_cookies(page)

        page.wait_for_selector("div.lista_elementos", timeout=90_000)
        players = extract_all(page)

        browser.close()

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(players),
        "players": players,
    }
    with open("market.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"💾 market.json guardado con {len(players)} jugadores.")

if __name__ == "__main__":
    main()
