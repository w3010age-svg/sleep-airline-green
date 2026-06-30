#!/usr/bin/env python3
"""Raspberry Pi GPIO button controller for Sleep Airline.

One press on GPIO17 toggles the current passenger between takeoff and landing,
then plays the generated captain broadcast through the Pi speaker.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from gpiozero import Button
except ImportError:  # pragma: no cover - only happens off Raspberry Pi
    Button = None  # type: ignore[assignment]


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / ".env.pi"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(Path(os.environ.get("SLEEP_AIRLINE_PI_ENV", DEFAULT_ENV_FILE)))


BASE_URL = os.environ.get("SLEEP_AIRLINE_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
PASSENGER_ID = os.environ.get("SLEEP_AIRLINE_PASSENGER_ID", "pi_passenger")
PASSENGER_NAME = os.environ.get("SLEEP_AIRLINE_PASSENGER_NAME", "Raspberry Pi Passenger")
GROUP_ID = os.environ.get("SLEEP_AIRLINE_GROUP_ID", "group_15")
ROUTE_DIRECTION = os.environ.get("SLEEP_AIRLINE_ROUTE_DIRECTION", "auto")
BROADCAST_STYLE = os.environ.get("SLEEP_AIRLINE_BROADCAST_STYLE", "flight_attendant")
BUTTON_GPIO = int(os.environ.get("SLEEP_AIRLINE_BUTTON_GPIO", "17"))
REQUEST_TIMEOUT = float(os.environ.get("SLEEP_AIRLINE_REQUEST_TIMEOUT", "120"))
AUDIO_PLAYER = os.environ.get("SLEEP_AIRLINE_AUDIO_PLAYER", "mpg123")

busy_lock = threading.Lock()
last_press_at = 0.0


def api_json(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(
        BASE_URL + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT) as res:
            payload = res.read().decode("utf-8")
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API {path} failed: {err.code} {detail}") from err
    except URLError as err:
        raise RuntimeError(f"Cannot reach Sleep Airline server: {err.reason}") from err
    return json.loads(payload or "{}")


def fetch_speech(text: str, style: str) -> bytes:
    data = json.dumps({"text": text, "style": style}).encode("utf-8")
    req = Request(
        BASE_URL + "/api/broadcast/speech",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, timeout=REQUEST_TIMEOUT) as res:
        return res.read()


def play_mp3(audio: bytes) -> None:
    player = shutil.which(AUDIO_PLAYER)
    if not player:
        raise RuntimeError(f"Audio player not found: {AUDIO_PLAYER}. Install mpg123 first.")

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp:
        temp.write(audio)
        audio_path = temp.name

    try:
        subprocess.run([player, "-q", audio_path], check=True)
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass


def say_broadcast(text: str, style: str = BROADCAST_STYLE) -> None:
    if not text:
        print("No broadcast text returned.")
        return
    print(text)
    try:
        play_mp3(fetch_speech(text, style))
    except Exception as err:
        print(f"Speech playback failed: {err}", file=sys.stderr)


def handle_button_press() -> None:
    global last_press_at

    now = time.monotonic()
    if now - last_press_at < 1.2:
        return
    last_press_at = now

    if not busy_lock.acquire(blocking=False):
        print("Already handling a flight action; press ignored.")
        return

    try:
        print("Button pressed. Checking passenger status...")
        profile = api_json(
            "POST",
            "/api/passenger",
            {"passengerId": PASSENGER_ID, "name": PASSENGER_NAME, "groupId": GROUP_ID},
        )
        passenger = profile.get("passenger", {})

        if passenger.get("status") == "in_flight":
            print("Landing flight...")
            result = api_json(
                "POST",
                "/api/flight/land",
                {
                    "passengerId": PASSENGER_ID,
                    "name": PASSENGER_NAME,
                    "groupId": GROUP_ID,
                    "broadcastStyle": BROADCAST_STYLE,
                },
            )
            flight = result.get("flight", {})
            say_broadcast(flight.get("captainBroadcast", ""), BROADCAST_STYLE)
        else:
            print("Taking off...")
            result = api_json(
                "POST",
                "/api/flight/takeoff",
                {
                    "passengerId": PASSENGER_ID,
                    "name": PASSENGER_NAME,
                    "groupId": GROUP_ID,
                    "routeDirection": ROUTE_DIRECTION,
                    "broadcastStyle": BROADCAST_STYLE,
                },
            )
            flight = result.get("flight", {})
            say_broadcast(flight.get("takeoffBroadcast", ""), BROADCAST_STYLE)
    except Exception as err:
        print(f"Button action failed: {err}", file=sys.stderr)
    finally:
        busy_lock.release()


def main() -> int:
    if Button is None:
        print("gpiozero is not installed. Run: sudo apt install python3-gpiozero", file=sys.stderr)
        return 1

    print("Sleep Airline Pi button controller")
    print(f"Server: {BASE_URL}")
    print(f"Passenger: {PASSENGER_ID} / {PASSENGER_NAME} / {GROUP_ID}")
    print(f"GPIO: BCM {BUTTON_GPIO}")
    print("Press Ctrl+C to stop.")

    button = Button(BUTTON_GPIO, pull_up=True, bounce_time=0.08)
    button.when_pressed = lambda: threading.Thread(target=handle_button_press, daemon=True).start()

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    stop.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
