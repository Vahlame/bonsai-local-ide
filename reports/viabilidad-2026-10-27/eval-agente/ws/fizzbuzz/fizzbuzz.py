def fizzbuzz(n):
    """Devuelve la lista de textos de 1 a n.

    "Fizz" si es múltiplo de 3, "Buzz" si lo es de 5,
    "FizzBuzz" si es múltiplo de ambos, y el número como texto
    en cualquier otro caso.
    """
    result = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(i))
    return result


if __name__ == "__main__":
    for text in fizzbuzz(15):
        print(text)
