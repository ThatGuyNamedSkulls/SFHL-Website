import numpy as np
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap, Normalize

# === Dados de exemplo ===
elo = np.array([18,25,22,36,38,57,46,63,50,40,58,63,71,81,120])
x = np.arange(len(elo))

# === Densificação dos pontos para suavizar as transições ===
# Em vez de usar apenas os pontos originais (que criam segmentos visíveis e "em blocos"),
# criamos muitos sub-segmentos lineares entre cada par de pontos originais. Isso permite
# que o gradiente de cor e o contorno apareçam mais suaves. Não adicionamos dependências
# externas (scipy); usamos interpolação linear com upsampling.
upsample_per_segment = 12  # quantos sub-segmentos criar entre dois pontos consecutivos

# Constroi arrays densos (x_dense, y_dense) juntando sublinspaces entre cada par de pontos
x_dense_list = []
y_dense_list = []
for i in range(len(x) - 1):
        xs = np.linspace(x[i], x[i+1], upsample_per_segment + 1)
        ys = np.linspace(elo[i], elo[i+1], upsample_per_segment + 1)
        # evita duplicar o último ponto de cada segmento, exceto no último segmento
        if i < len(x) - 2:
                xs = xs[:-1]
                ys = ys[:-1]
        x_dense_list.append(xs)
        y_dense_list.append(ys)

x_dense = np.concatenate(x_dense_list)
y_dense = np.concatenate(y_dense_list)

# Garante o último ponto
x_dense = np.append(x_dense, x[-1])
y_dense = np.append(y_dense, elo[-1])

# Inclinações por sub-segmento e normalização (-1..1)
slope_dense = np.diff(y_dense)
max_s = np.max(np.abs(slope_dense)) if slope_dense.size > 0 else 1.0
if max_s == 0:
        slope_norm = slope_dense
else:
        slope_norm = slope_dense / max_s

# === Segmentos (densos) ===
points = np.array([x_dense, y_dense]).T.reshape(-1, 1, 2)
segments = np.concatenate([points[:-1], points[1:]], axis=1)

# === Color array contínuo / gradiente suave ===
# Opções: 'position' (esquerda→direita), 'elo' (valor), 'slope_smoothed' (inclinacao suavizada)
color_mode = 'slope_smoothed'

if color_mode == 'position':
        # gradiente uniforme ao longo do comprimento da linha
        color_array = np.linspace(-1.0, 1.0, len(segments))
elif color_mode == 'elo':
        # usa o valor de elo (y_dense) para colorir, normalizando para -1..1
        vals = y_dense[:-1]
        vmin, vmax = vals.min(), vals.max()
        if vmax - vmin == 0:
                color_array = np.zeros(len(vals))
        else:
                color_array = (vals - vmin) / (vmax - vmin) * 2 - 1
else:
        # suaviza a inclinação com média móvel para obter transições de cor suaves
        # slope_norm tem comprimento = len(segments)
        window = 15  # tamanho da janela de suavização (ajustável)
        kernel = np.ones(window) / window
        # modo='same' mantém o mesmo comprimento
        color_array = np.convolve(slope_norm, kernel, mode='same')
        # normaliza para a faixa -1..1
        max_abs = np.max(np.abs(color_array)) if color_array.size > 0 else 1.0
        if max_abs != 0:
                color_array = color_array / max_abs


# === Gradiente de cor: vermelho (-1) → amarelo (0) → verde (+1) ===
cmap = LinearSegmentedColormap.from_list(
    "elo_slope",
    [
        (0.0, "#ff3333"),  # vermelho
        (0.5, "#ffff66"),  # amarelo
        (1.0, "#33ff33"),  # verde
    ]
)
norm = Normalize(vmin=-1, vmax=1)

# === Cria o LineCollection principal ===
# Cria o LineCollection usando o array de cor contínuo
lc = LineCollection(segments, cmap=cmap, norm=norm)
lc.set_array(color_array)
lc.set_linewidth(2)
# suaviza junções e habilita antialiasing
try:
        lc.set_joinstyle('round')
        lc.set_capstyle('round')
except Exception:
        # alguns backends/matplotlib versions podem não suportar capstyle; ignore se falhar
        pass
lc.set_antialiaseds(True)

# === Configuração do gráfico ===
fig, ax = plt.subplots(figsize=(10, 3))
ax.set_facecolor("#0E1114")
ax.set_xlim(x.min(), x.max())
ax.set_ylim(elo.min() - 10, elo.max() + 10)
ax.axis("off")

# === Efeito "neon glow" ===
# Desenha várias linhas verdes com transparência decrescente e espessura crescente
for glow_width, alpha in [(8, 0.05), (5, 0.1), (3, 0.2), (2, 0.3)]:
        lc_glow = LineCollection(segments, cmap=cmap, norm=norm)
        # glow usa mesmo gradiente contínuo para seguir a linha suavemente
        lc_glow.set_array(color_array)
        lc_glow.set_linewidth(glow_width)
        lc_glow.set_alpha(alpha)
        try:
                lc_glow.set_joinstyle('round')
                lc_glow.set_capstyle('round')
        except Exception:
                pass
        lc_glow.set_antialiaseds(True)
        ax.add_collection(lc_glow)

# === Linha principal ===
ax.add_collection(lc)

# === Marcadores (dots) nos pontos originais ===
# Calcula cores para os marcadores mapeando as posições originais `x` ao
# `color_array` (que foi gerado sobre os segmentos densos) e usa o colormap
# para obter cores RGBA.
# `color_array` tem tamanho igual ao número de segmentos (len(segments)) enquanto
# `x_dense` tem um ponto a mais. Para interpolar corretamente, usamos as posições
# médias de cada segmento como coordenadas (x) correspondentes a `color_array`.
x_seg = (x_dense[:-1] + x_dense[1:]) / 2.0
# estende as bordas para garantir que valores em x=0 e x=max(x) tenham cor definida
x_seg_ext = np.concatenate(([x_dense[0]], x_seg, [x_dense[-1]]))
color_ext = np.concatenate(([color_array[0]], color_array, [color_array[-1]]))
marker_vals = np.interp(x, x_seg_ext, color_ext)
sm = plt.cm.ScalarMappable(norm=norm, cmap=cmap)
marker_rgba = sm.to_rgba(marker_vals)

# Glow leve atrás dos pontos
for size, a in [(220, 0.06), (120, 0.05)]:
        ax.scatter(x, elo, s=size, color=marker_rgba, alpha=a, linewidths=0, zorder=2)

# Pontos principais
ax.scatter(x, elo, s=20, c=marker_rgba, linewidths=0.8, zorder=4)

# === Pontos e rótulos ===
min_idx = np.argmin(elo)
max_idx = np.argmax(elo)
now_idx = len(elo) - 1

# === Salva o resultado ===
plt.savefig("elo_neon_gradient.png", transparent=True, bbox_inches='tight', pad_inches=0)
plt.close()