from . import sheets


def main() -> None:
    changes = sheets.ensure_current_schema()
    if changes:
        print("Schema atualizado: " + ", ".join(changes))
    else:
        print("Schema já está atualizado.")


if __name__ == "__main__":
    main()
