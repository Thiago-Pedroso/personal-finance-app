"""Cliente Pluggy: autenticação e busca paginada de contas/transações."""

import os
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv
import pluggy_sdk
from pluggy_sdk import ApiClient, Configuration
from pluggy_sdk.models import AuthRequest, Item

load_dotenv()

# Bug do SDK: a API devolve products novos (ex.: EXCHANGE_OPERATIONS) que esta
# versão do SDK ainda não conhece e rejeita na validação. Filtramos para os
# conhecidos antes de validar (não usamos esse campo no app).
_ITEM_KNOWN_PRODUCTS = {
    "ACCOUNTS", "CREDIT_CARDS", "TRANSACTIONS", "PAYMENT_DATA", "INVESTMENTS",
    "INVESTMENTS_TRANSACTIONS", "IDENTITY", "BROKERAGE_NOTE", "MOVE_SECURITY", "LOANS",
}
_original_item_from_dict = Item.from_dict.__func__


@classmethod
def _patched_item_from_dict(cls, obj):
    if obj and isinstance(obj.get("products"), list):
        obj = {**obj, "products": [p for p in obj["products"]
                                   if p in _ITEM_KNOWN_PRODUCTS]}
    return _original_item_from_dict(cls, obj)


Item.from_dict = _patched_item_from_dict


def get_api_key() -> str:
    """API key (JWT, ~2h). Cacheie durante a execução; não chame a cada request."""
    client_id = os.environ["CLIENT_ID"]
    client_secret = os.environ["CLIENT_SECRET"]
    with ApiClient(Configuration()) as client:
        auth_api = pluggy_sdk.AuthApi(client)
        resp = auth_api.auth_create(
            AuthRequest(client_id=client_id, client_secret=client_secret)
        )
    return resp.api_key


def build_client(api_key: str) -> ApiClient:
    return ApiClient(Configuration(api_key={"default": api_key}))


def item_ids() -> list[str]:
    return [i.strip() for i in os.environ.get("ITEM_IDS", "").split(",") if i.strip()]


def list_accounts(client: ApiClient, item_id: str) -> list:
    return pluggy_sdk.AccountApi(client).accounts_list(item_id=item_id).results


def fetch_transactions(
    client: ApiClient,
    account_id: str,
    var_from=None,
    created_at_from=None,
) -> list:
    """Busca todas as transações da conta paginando até o fim (endpoint v2, cursor-based;
    o v1 paginado por `page`/`page_size` foi descontinuado pela Pluggy).

    - `var_from`: filtro por DATA da transação (usado no backfill).
    - `created_at_from`: filtro pela data de INSERÇÃO na Pluggy (usado no incremental;
      pega lançamentos retroativos que entraram depois do último sync).
    """
    api = pluggy_sdk.TransactionApi(client)
    out: list = []
    after = None
    while True:
        kwargs = {"account_id": account_id}
        if var_from is not None:
            kwargs["date_from"] = var_from
        if created_at_from is not None:
            kwargs["created_at_from"] = created_at_from
        if after is not None:
            kwargs["after"] = after
        resp = api.transactions_list_by_cursor(**kwargs)
        out.extend(resp.results)
        if not resp.next:
            break
        # `next` vem como querystring completa (ex.: "?after=<cursor>"); a API só aceita
        # o valor de `after` isolado e já decodificado.
        after = parse_qs(urlparse(resp.next).query).get("after", [None])[0]
        if not after:
            break
    return out
