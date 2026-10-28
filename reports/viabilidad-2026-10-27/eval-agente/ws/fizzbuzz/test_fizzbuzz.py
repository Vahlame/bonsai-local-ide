import unittest

from fizzbuzz import fizzbuzz


class FizzBuzzTest(unittest.TestCase):

    def test_rango_completo(self):
        self.assertEqual(
            fizzbuzz(15),
            [
                "1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8",
                "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz",
            ],
        )

    def test_caso_vacio(self):
        self.assertEqual(fizzbuzz(0), [])

    def test_multiplo_de_3(self):
        self.assertEqual(fizzbuzz(3), ["1", "2", "Fizz"])

    def test_multiplo_de_5(self):
        self.assertEqual(fizzbuzz(5), ["1", "2", "Fizz", "4", "Buzz"])

    def test_multiplo_de_6(self):
        self.assertEqual(fizzbuzz(6), ["1", "2", "Fizz", "4", "Buzz", "Fizz"])

    def test_multiplo_de_15(self):
        self.assertEqual(fizzbuzz(15)[-1], "FizzBuzz")

    def test_numeros_no_son_multiplos(self):
        self.assertEqual(fizzbuzz(10)[0], "1")
        self.assertEqual(fizzbuzz(10)[1], "2")


if __name__ == "__main__":
    unittest.main()
