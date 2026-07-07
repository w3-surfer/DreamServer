"""Proxy endpoints for the optional `solana` wallet/RPC extension.

A read-only wallet surface for the dashboard: address (with a locally rendered
QR), balance, network, and a devnet airdrop button. There is intentionally no
transfer or secret-key surface here. Returns 503 when the extension is not
enabled so the UI can prompt the user to turn it on.
"""

import base64
import io
import logging
import os
from typing import Optional

import aiohttp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, HTTPException

from config import SERVICES
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["solana"])

# The solana service may require a bearer on its write routes; forward it from
# the dashboard-api env so the airdrop proxy keeps working when it is set.
_SOLANA_API_KEY = os.environ.get("SOLANA_API_KEY", "")
_TIMEOUT = aiohttp.ClientTimeout(total=15)


def _base_url() -> str:
    cfg = SERVICES.get("solana")
    if not cfg:
        raise HTTPException(status_code=503, detail="Solana extension is not enabled")
    return f"http://{cfg['host']}:{cfg['external_port']}"


def _qr_data_uri(text: str) -> str:
    """Render `text` as an SVG QR code data URI. Generated locally — the wallet
    address never leaves the box (no external QR service)."""
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgImage)
    buf = io.BytesIO()
    img.save(buf)
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


async def _get(path: str, params: Optional[dict] = None) -> dict:
    url = _base_url() + path
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as http:
            async with http.get(url, params=params) as resp:
                resp.raise_for_status()
                return await resp.json()
    except aiohttp.ClientError as exc:
        logger.warning("solana proxy GET %s failed: %s", path, exc)
        raise HTTPException(status_code=502, detail="Solana service request failed")


@router.get("/api/solana/config")
async def solana_config(api_key: str = Depends(verify_api_key)):
    """Network + RPC info (from the service's /health)."""
    return await _get("/health")


@router.get("/api/solana/wallet")
async def solana_wallet(api_key: str = Depends(verify_api_key)):
    """Managed wallet public key plus a locally rendered QR of the address."""
    data = await _get("/wallet/pubkey")
    pubkey = data.get("pubkey", "")
    return {"pubkey": pubkey, "qr": _qr_data_uri(pubkey) if pubkey else None}


@router.get("/api/solana/balance")
async def solana_balance(pubkey: Optional[str] = None, api_key: str = Depends(verify_api_key)):
    """SOL balance of the managed wallet (or a given pubkey)."""
    return await _get("/balance", params={"pubkey": pubkey} if pubkey else None)


@router.post("/api/solana/airdrop")
async def solana_airdrop(body: Optional[dict] = None, api_key: str = Depends(verify_api_key)):
    """Request a devnet airdrop to the managed wallet. The service itself
    enforces devnet-only, so this cannot touch mainnet funds."""
    url = _base_url() + "/airdrop"
    headers = {"Authorization": f"Bearer {_SOLANA_API_KEY}"} if _SOLANA_API_KEY else {}
    payload = {"sol": (body or {}).get("sol", 1)}
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as http:
            async with http.post(url, json=payload, headers=headers) as resp:
                data = await resp.json()
                if resp.status >= 400:
                    raise HTTPException(status_code=resp.status, detail=data.get("error", "airdrop failed"))
                return data
    except aiohttp.ClientError as exc:
        logger.warning("solana airdrop proxy failed: %s", exc)
        raise HTTPException(status_code=502, detail="Solana airdrop request failed")
