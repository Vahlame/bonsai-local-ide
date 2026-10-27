#!/usr/bin/env python3
"""Genera el icono de Bonsai IDE (recursos/bonsai-ide.ico) y sus vistas previas.

Se dibuja a mano con Pillow a 8x y se reduce con LANCZOS: así queda nítido en todos
los tamaños. Los pequeños (16/32/48) tienen su propia versión simplificada, porque a
esos tamaños los detalles finos se convierten en ruido.

Necesita Pillow:  pip install pillow
    python scripts/crear-icono.py
"""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageOps

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DESTINO_ICO = os.path.join(RAIZ, "recursos", "bonsai-ide.ico")
PREVIA = os.path.join(RAIZ, "capturas", "13-icono.png")
TIRAS = os.path.join(RAIZ, "capturas", "14-icono-tamanos.png")

# Paleta de la app (chat/ui/tema.css): verde Bonsai sobre casi negro.
INK = (8, 10, 7)
BG = (13, 16, 11)
PANEL = (18, 22, 15)
RAISED = (25, 30, 20)
LINE = (44, 58, 34)
LINE_CLARO = (61, 80, 48)
TEXTO = (233, 238, 224)
APAGADO = (84, 97, 63)
LIMA = (214, 240, 122)
VERDE = (168, 212, 106)
VERDE_OSCURO = (127, 174, 74)
TRONCO = (138, 106, 68)
AMBAR = (229, 192, 123)
AZUL = (122, 162, 247)
MENTA = (137, 221, 255)
MALVA = (199, 146, 234)
NARANJA = (247, 140, 108)
ROJO = (255, 95, 87)
AMARILLO = (254, 188, 46)
VERDE_LUZ = (40, 200, 64)

SS = 8  # supermuestreo


def rgba(color, alfa=255):
    return (color[0], color[1], color[2], alfa)


def lienzo(tam):
    """Fondo: cuadrado redondeado con degradado verde-negro y un brillo arriba."""
    n = tam * SS
    radio = int(n * 0.22)
    mascara = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mascara).rounded_rectangle([0, 0, n - 1, n - 1], radius=radio, fill=255)

    degradado = ImageOps.colorize(Image.linear_gradient("L").resize((n, n)), INK, PANEL)
    brillo = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(brillo).ellipse(
        [-int(n * 0.35), -int(n * 0.45), int(n * 1.05), int(n * 0.75)],
        fill=rgba((46, 66, 32), 110),
    )
    brillo = brillo.filter(ImageFilter.GaussianBlur(n * 0.16))
    fondo = Image.alpha_composite(degradado.convert("RGBA"), brillo)
    fuera = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    fuera.paste(fondo, (0, 0), mascara)
    return fuera


def dibujar(tam, detalle):
    """detalle: "alto" (>=64), "medio" (32-48) o "bajo" (16-24)."""
    n = tam * SS
    img = lienzo(tam)
    d = ImageDraw.Draw(img)

    def c(v):
        return v * n

    # ---------------------------------------------------------------- ventana IDE
    x0, y0, x1, y1 = c(0.055), c(0.075), c(0.945), c(0.925)
    radio = c(0.062)
    sombra = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).rounded_rectangle([x0, y0 + c(0.012), x1, y1 + c(0.012)], radius=radio, fill=(0, 0, 0, 190))
    img.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(c(0.02))))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x1, y1], radius=radio, fill=rgba(BG), outline=rgba(LINE), width=max(1, int(c(0.006))))

    alto_titulo = c(0.105)
    y_titulo = y0 + alto_titulo
    d.rounded_rectangle([x0, y0, x1, y_titulo + radio * 0.4], radius=radio, fill=rgba((22, 29, 16)))
    d.rectangle([x0, y_titulo - c(0.004), x1, y_titulo], fill=rgba(LINE))

    if detalle != "bajo":
        # Semáforos de la ventana.
        r = c(0.019)
        cy = y0 + alto_titulo / 2
        for i, color in enumerate((ROJO, AMARILLO, VERDE_LUZ)):
            cx = x0 + c(0.055) + i * c(0.048)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(color))
            d.ellipse([cx - r * 0.45, cy - r * 0.6, cx + r * 0.5, cy + r * 0.35], fill=rgba((255, 255, 255), 60))
        # Chip "GPU" a la derecha de la barra de título.
        ch_w, ch_h = c(0.075), c(0.05)
        ch_x, ch_y = x1 - c(0.055) - ch_w, cy - ch_h / 2
        d.rounded_rectangle([ch_x, ch_y, ch_x + ch_w, ch_y + ch_h], radius=c(0.012), fill=rgba((32, 44, 22)), outline=rgba(LINE_CLARO), width=max(1, int(c(0.004))))
        for k in range(3):
            px = ch_x + ch_w * (0.25 + k * 0.25)
            d.rectangle([px - c(0.004), ch_y - c(0.008), px + c(0.004), ch_y], fill=rgba(LINE_CLARO))
            d.rectangle([px - c(0.004), ch_y + ch_h, px + c(0.004), ch_y + ch_h + c(0.008)], fill=rgba(LINE_CLARO))
        d.ellipse([ch_x + ch_w * 0.36, ch_y + ch_h * 0.32, ch_x + ch_w * 0.64, ch_y + ch_h * 0.68], fill=rgba(LIMA))

    # ------------------------------------------------------------------- pestañas
    y_tab = y_titulo
    alto_tab = c(0.055)
    if detalle == "alto":
        d.rounded_rectangle([x0 + c(0.045), y_tab, x0 + c(0.30), y_tab + alto_tab], radius=c(0.016), fill=rgba((18, 24, 13)))
        d.rectangle([x0 + c(0.045), y_tab + alto_tab - c(0.006), x0 + c(0.30), y_tab + alto_tab], fill=rgba(LIMA))
        d.rounded_rectangle([x0 + c(0.065), y_tab + c(0.014), x0 + c(0.085), y_tab + alto_tab - c(0.014)], radius=c(0.006), fill=rgba(AZUL))
        d.rounded_rectangle([x0 + c(0.095), y_tab + c(0.020), x0 + c(0.24), y_tab + c(0.032)], radius=c(0.006), fill=rgba(APAGADO))
        d.rounded_rectangle([x0 + c(0.32), y_tab + c(0.014), x0 + c(0.46), y_tab + alto_tab - c(0.006)], radius=c(0.012), fill=rgba((15, 19, 11)))
        d.rounded_rectangle([x0 + c(0.34), y_tab + c(0.024), x0 + c(0.44), y_tab + c(0.034)], radius=c(0.005), fill=rgba((60, 74, 46)))

    # ------------------------------------------------------------------ lateral
    y_ini = y_tab + (alto_tab if detalle == "alto" else 0)
    ancho_lat = c(0.24)
    x_lat = x0 + ancho_lat
    d.rectangle([x0, y_ini, x_lat, y1 - c(0.06)], fill=rgba((16, 21, 9)) if detalle != "bajo" else rgba(PANEL))
    if detalle != "bajo":
        colores = (AMBAR, AZUL, MENTA, LIMA)
        filas = 4 if detalle == "medio" else 5
        alto_fila = (y1 - c(0.06) - y_ini - c(0.03)) / filas
        for i in range(filas):
            fy = y_ini + c(0.02) + i * alto_fila
            if i == 1:
                d.rounded_rectangle([x0 + c(0.012), fy, x_lat - c(0.015), fy + alto_fila - c(0.012)], radius=c(0.012), fill=rgba((24, 34, 15)))
                d.rectangle([x0 + c(0.012), fy, x0 + c(0.02), fy + alto_fila - c(0.012)], fill=rgba(LIMA))
            cy_f = fy + alto_fila / 2
            r = c(0.011)
            d.ellipse([x0 + c(0.038) - r, cy_f - r, x0 + c(0.038) + r, cy_f + r], fill=rgba(colores[i % len(colores)]))
            ancho_barra = c(0.10) if i % 2 == 0 else c(0.075)
            d.rounded_rectangle([x0 + c(0.062), cy_f - c(0.008), x0 + c(0.062) + ancho_barra, cy_f + c(0.008)], radius=c(0.008), fill=rgba((64, 80, 48)))

    # --------------------------------------------------------------- código
    y_cod = y_ini + c(0.02)
    y_fin = y1 - c(0.06)
    x_cod = x_lat + c(0.03)
    if detalle == "alto":
        d.rectangle([x_lat, y_ini, x_lat + c(0.004), y_fin], fill=rgba(LINE))
        # Canal de números de línea.
        filas = 8
        alto_linea = (y_fin - y_cod) / filas
        for i in range(filas):
            ly = y_cod + i * alto_linea + alto_linea / 2
            ancho = c(0.022) if i < 9 else c(0.03)
            d.rounded_rectangle([x_cod, ly - c(0.007), x_cod + ancho, ly + c(0.007)], radius=c(0.007), fill=rgba((45, 60, 34)))
    else:
        filas = 4 if detalle == "medio" else 3
        alto_linea = (y_fin - y_cod) / filas

    # Segmentos de código: (sangría, ancho, color) por línea.
    guion = [
        [(0.00, 0.10, MALVA), (0.11, 0.08, MENTA), (0.20, 0.16, AZUL)],
        [(0.06, 0.12, TEXTO), (0.19, 0.05, MENTA), (0.25, 0.14, VERDE)],
        [(0.06, 0.06, MALVA), (0.13, 0.10, AZUL), (0.24, 0.06, NARANJA)],
        [(0.12, 0.22, APAGADO)],
        [(0.00, 0.07, MALVA), (0.08, 0.05, TEXTO), (0.14, 0.18, AZUL), (0.33, 0.05, MENTA)],
        [(0.06, 0.10, VERDE), (0.17, 0.07, NARANJA)],
        [(0.06, 0.05, TEXTO), (0.12, 0.13, AZUL), (0.26, 0.04, MENTA)],
        [(0.00, 0.06, MALVA)],
    ]
    x_texto = x_cod + c(0.045) if detalle == "alto" else x_cod + c(0.02)
    # En los tamaños pequeños las líneas van más gruesas: si no, se pierden.
    grosor = c(0.011) if detalle == "alto" else (c(0.019) if detalle == "medio" else c(0.024))
    for i in range(min(filas, len(guion))):
        ly = y_cod + i * alto_linea + alto_linea * 0.5
        for sangria, ancho, color in guion[i]:
            bx = x_texto + sangria * n * 0.55
            if bx + ancho * n * 0.55 > x1 - c(0.09):
                continue
            d.rounded_rectangle(
                [bx, ly - grosor, bx + ancho * n * 0.55, ly + grosor],
                radius=grosor,
                fill=rgba(color, 235 if detalle == "alto" else 255),
            )

    if detalle == "alto":
        # Cursor con brillo, como el del editor de la app.
        cx = x_texto + c(0.30)
        cy = y_cod + 4 * alto_linea + alto_linea * 0.5
        halo = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(halo).rounded_rectangle([cx, cy - c(0.022), cx + c(0.014), cy + c(0.022)], radius=c(0.006), fill=rgba(LIMA, 120))
        img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(c(0.012))))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([cx, cy - c(0.018), cx + c(0.012), cy + c(0.018)], radius=c(0.005), fill=rgba(LIMA))
        # Minimapa a la derecha: muy de IDE.
        mx = x1 - c(0.055)
        for i in range(14):
            my = y_cod + i * ((y_fin - y_cod) / 14) + c(0.006)
            ancho = c(0.022) + (c(0.012) if i % 3 == 0 else 0)
            d.rounded_rectangle([mx, my, mx + ancho, my + c(0.008)], radius=c(0.004), fill=rgba((36, 48, 27), 220))
        # Bonsái en el lateral: la marca.
        bx, by = x0 + c(0.055), y1 - c(0.115)
        d.rounded_rectangle([bx - c(0.006), by, bx + c(0.006), by + c(0.055)], radius=c(0.006), fill=rgba(TRONCO))
        for dx, dy, r, col in ((0.0, -0.012, 0.036, VERDE_OSCURO), (-0.032, 0.012, 0.026, VERDE), (0.032, 0.010, 0.026, VERDE)):
            d.ellipse([bx + c(dx) - c(r), by + c(dy) - c(r), bx + c(dx) + c(r), by + c(dy) + c(r)], fill=rgba(col))
        d.ellipse([bx - c(0.020), by - c(0.026), bx + c(0.020), by + c(0.010)], fill=rgba(LIMA))

    # -------------------------------------------------------------- barra de estado
    y_est = y1 - c(0.06)
    d.rounded_rectangle([x0, y_est, x1, y1], radius=radio, fill=rgba((22, 29, 16)))
    d.rectangle([x0, y_est, x1, y_est + c(0.004)], fill=rgba(LINE))
    r = c(0.013)
    cy_e = y_est + c(0.032)
    d.ellipse([x0 + c(0.05) - r, cy_e - r, x0 + c(0.05) + r, cy_e + r], fill=rgba(LIMA))
    d.rounded_rectangle([x0 + c(0.078), cy_e - c(0.009), x0 + c(0.20), cy_e + c(0.009)], radius=c(0.009), fill=rgba((74, 92, 55)))
    if detalle == "alto":
        d.rounded_rectangle([x1 - c(0.16), cy_e - c(0.009), x1 - c(0.10), cy_e + c(0.009)], radius=c(0.009), fill=rgba((54, 68, 40)))
        d.rounded_rectangle([x1 - c(0.09), cy_e - c(0.009), x1 - c(0.045), cy_e + c(0.009)], radius=c(0.009), fill=rgba((54, 68, 40)))

    return img.resize((tam, tam), Image.LANCZOS)


def main():
    os.makedirs(os.path.dirname(DESTINO_ICO), exist_ok=True)
    os.makedirs(os.path.dirname(PREVIA), exist_ok=True)

    grandes = {tam: dibujar(tam, "alto") for tam in (256, 128, 64)}
    medianos = {tam: dibujar(tam, "medio") for tam in (48, 32)}
    chicos = {tam: dibujar(tam, "bajo") for tam in (24, 16)}

    base = grandes[256]
    base.save(PREVIA)

    # Tira de comprobación a tamaño real, sobre fondo neutro.
    tam_tira = 24 + (16 + 24 + 32 + 48 + 64 + 128 + 256) + 24
    tira = Image.new("RGBA", (tam_tira, 300), (32, 36, 30, 255))
    x = 24
    for tam in (16, 24, 32, 48, 64, 128, 256):
        icono = grandes.get(tam) or medianos.get(tam) or chicos[tam]
        tira.alpha_composite(icono, (x, 270 - tam))
        x += tam + 16
    tira.save(TIRAS)

    # ICO multi-tamaño: Pillow usa las imágenes que le pasemos para cada medida.
    imagenes = [grandes[256], grandes[128], grandes[64], medianos[48], medianos[32], chicos[24], chicos[16]]
    imagenes[0].save(
        DESTINO_ICO,
        format="ICO",
        append_images=imagenes[1:],
        sizes=[(im.width, im.height) for im in imagenes],
    )
    print(f"ico: {DESTINO_ICO} ({os.path.getsize(DESTINO_ICO)} bytes)")
    print(f"previa: {PREVIA}")
    print(f"tamaños: {TIRAS}")


if __name__ == "__main__":
    main()
