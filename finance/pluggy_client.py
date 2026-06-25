"""Cliente Pluggy: autenticação e busca paginada de contas/transações."""

import os

from dotenv import load_dotenv
import pluggy_sdk
from pluggy_sdk import ApiClient, Configuration
from pluggy_sdk.models import AuthRequest, CreditCardMetadata, Item

load_dotenv()

# Bug do SDK: a API devolve payeeMCC como int, mas o model declara StrictStr.
_original_cc_from_dict = CreditCardMetadata.from_dict.__func__


@classmethod
def _patched_cc_from_dict(cls, obj):
    if obj and obj.get("payeeMCC") is not None:
        obj = {**obj, "payeeMCC": str(obj["payeeMCC"])}
    return _original_cc_from_dict(cls, obj)


CreditCardMetadata.from_dict = _patched_cc_from_dict

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
    page_size: int = 500,
) -> list:
    """Busca todas as transações da conta paginando até o fim.

    - `var_from`: filtro por DATA da transação (usado no backfill).
    - `created_at_from`: filtro pela data de INSERÇÃO na Pluggy (usado no incremental;
      pega lançamentos retroativos que entraram depois do último sync).
    """
    api = pluggy_sdk.TransactionApi(client)
    out: list = []
    page = 1
    while True:
        kwargs = {"account_id": account_id, "page_size": page_size, "page": page}
        if var_from is not None:
            kwargs["var_from"] = var_from
        if created_at_from is not None:
            kwargs["created_at_from"] = created_at_from
        resp = api.transactions_list(**kwargs)
        out.extend(resp.results)
        total_pages = int(resp.total_pages or 1)
        if page >= total_pages or not resp.results:
            break
        page += 1
    return out
