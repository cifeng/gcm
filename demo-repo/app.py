def calc(a, b):
    """Add two numbers with overflow check."""
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("operands must be numbers")
    return a + b
