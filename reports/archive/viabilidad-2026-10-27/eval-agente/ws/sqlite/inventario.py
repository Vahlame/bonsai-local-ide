import sqlite3

# Elimina el archivo si existe y crea la base de datos nueva
try:
    import os
    if os.path.exists("inventario.db"):
        os.remove("inventario.db")
except Exception:
    pass

conn = sqlite3.connect("inventario.db")
cur = conn.cursor()

# Crea la tabla productos
cur.execute("""
    CREATE TABLE productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        stock INTEGER NOT NULL
    )
""")

# Inserta 4 productos
productos = [
    ("tornillo", 120),
    ("tuerca", 3),
    ("arandela", 40),
    ("clavo", 2),
]
cur.executemany("INSERT INTO productos (nombre, stock) VALUES (?, ?)", productos)
conn.commit()

# Muestra los productos con stock menor que 5
cur.execute("SELECT id, nombre, stock FROM productos WHERE stock < 5 ORDER BY stock ASC")
bajos = cur.fetchall()
print("Productos con stock menor que 5:")
for row in bajos:
    print(f"  - {row[1]}: {row[2]} en stock")

conn.close()
