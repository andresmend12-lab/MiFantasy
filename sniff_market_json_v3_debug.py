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

def dedupe_double_text(text: str | None) -> str:
    """
    Arregla nombres repetidos consecutivos:
    - 'Pau LópezPau López' -> 'Pau López'
    - 'Pau López Pau López' -> 'Pau López'
    - Soporta cualquier cadena duplicada exacta (con o sin espacio entre bloques).
    """
    if not text:
        return ""
    s = text.strip()
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
            raw_name = el.locator(".datos-nombre").inner_text().strip()
        except:
            raw_name = ga("data-nombre") or ""
        clean_name = dedupe_double_text(raw_name)

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
