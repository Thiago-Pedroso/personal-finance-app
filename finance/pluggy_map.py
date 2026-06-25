"""Mapa curado: categoria da Pluggy -> (nossa categoria, subcategoria).

Usado só como **dica/semente** (a Pluggy pode parar de categorizar fora do Pro).
subcategoria None = precisa ser refinada com o usuário/lojista.
Direção de transferência (enviado/recebido) é resolvida pelo `type` da transação.
"""

# Pluggy category (em inglês) -> (categoria, subcategoria | None)
PLUGGY_TO_TAXONOMY: dict[str, tuple[str, str | None]] = {
    # Alimentação
    "Eating out": ("Alimentação", "Restaurante"),
    "Food and drinks": ("Alimentação", "Restaurante"),
    "Food delivery": ("Alimentação", "Delivery"),
    "Groceries": ("Alimentação", "Supermercado"),
    # Transporte
    "Taxi and ride-hailing": ("Transporte", "App/Táxi"),
    "Gas stations": ("Transporte", "Combustível"),
    "Parking": ("Transporte", "Estacionamento"),
    "Transportation": ("Transporte", "Transporte público"),
    "Automotive": ("Transporte", "Manutenção"),
    "Car rental": ("Transporte", None),
    # Moradia
    "Housing": ("Moradia", None),
    "Telecommunications": ("Moradia", "Internet/TV"),
    # Saúde
    "Pharmacy": ("Saúde", "Farmácia"),
    "Wellness and fitness": ("Saúde", "Academia"),
    "Gyms and fitness centers": ("Saúde", "Academia"),
    # Lazer
    "Sports practice": ("Lazer", "Hobbies"),
    "Sports goods": ("Lazer", "Hobbies"),
    "Tickets": ("Lazer", "Cinema/Eventos"),
    "Video streaming": ("Lazer", "Streaming"),
    "Travel": ("Lazer", "Viagem"),
    "Accomodation": ("Lazer", "Viagem"),
    # Compras
    "Shopping": ("Compras", None),
    "Online shopping": ("Compras", None),
    "Houseware": ("Compras", "Casa"),
    "Electronics": ("Compras", "Eletrônicos"),
    "Clothing": ("Compras", "Vestuário"),
    "Pet supplies and vet": ("Compras", None),
    # Serviços
    "Digital services": ("Serviços", "Assinaturas"),
    "Services": ("Serviços", "Profissionais"),
    "Insurance": ("Serviços", "Profissionais"),
    "Bank fees": ("Serviços", "Bancário/Tarifas"),
    "Account fees": ("Serviços", "Bancário/Tarifas"),
    # Educação
    "School": ("Educação", "Cursos"),
    "Bookstore": ("Educação", "Livros"),
    # Impostos / Taxas
    "Tax on financial operations": ("Impostos/Taxas", "Impostos"),
    "Taxes on investments": ("Impostos/Taxas", "Impostos"),
    "Taxes": ("Impostos/Taxas", "Impostos"),
    "Interests charged": ("Impostos/Taxas", "Multas/Juros"),
    "Late payment and overdraft costs": ("Impostos/Taxas", "Multas/Juros"),
    # Investimentos
    "Investments": ("Investimentos", "Aporte"),
    "Mutual funds": ("Investimentos", "Aporte"),
    "Fixed income": ("Investimentos", "Aporte"),
    "Pension": ("Investimentos", "Aporte"),
    "Proceeds interests and dividends": ("Investimentos", "Rendimentos"),
    # Transferências (direção resolvida por tipo; ver suggest())
    "Credit card payment": ("Transferências", "Pagamento de cartão"),
}

# Categorias da Pluggy que são transferências genéricas (direção por tipo)
_TRANSFER_GENERIC = {"Transfer - PIX", "Transfer - TED", "Transfers", "Same person transfer"}


def suggest(pluggy_category: str | None, tx_type: str | None) -> tuple[str, str | None] | None:
    """Retorna (categoria, subcategoria) sugerida, ou None se não houver dica."""
    if not pluggy_category:
        return None
    if pluggy_category in _TRANSFER_GENERIC:
        if "PIX" in pluggy_category:
            sub = "PIX recebido" if tx_type == "CREDIT" else "PIX enviado"
        elif "TED" in pluggy_category:
            sub = "TED/DOC"
        else:
            sub = "PIX recebido" if tx_type == "CREDIT" else "TED/DOC"
        return ("Transferências", sub)
    return PLUGGY_TO_TAXONOMY.get(pluggy_category)
