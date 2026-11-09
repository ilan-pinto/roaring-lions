"""Reduced-scale (1 char = 2x2 tiles) sketch of an 80x80 versus map, point-symmetric by construction.
Rows 0..19 are generated from rules; rows 20..39 are their half-turn image. Then checked:
symmetry, foot and vehicle connectivity seat to seat, and that each vehicle ford is a real cut."""
import math, collections

N = 40
g = [['.' for _ in range(N)] for _ in range(N)]
e = [[1 for _ in range(N)] for _ in range(N)]  # elevation, sketch digit

def put(x, y, c, h=None):
    if 0 <= x < N and 0 <= y < N:
        g[y][x] = c
        if h is not None: e[y][x] = h

# --- the wadi: a meander along the anti-diagonal, channel 'd', bed elevation 0 ----------------
def hoff(x):
    return round(1.6 * math.sin(2 * math.pi * (x - 19.5) / 26))
chan = set()
for x in range(7, 33):
    y = 39 - x + hoff(x)
    chan.add((x, y))
    y2 = 39 - (x + 1) + hoff(x + 1) if x + 1 < 33 else None
    if y2 is not None:
        for yy in range(min(y, y2) + 1, max(y, y2)):  # keep it 4-connected
            chan.add((x, yy))
        if y2 == y + 1 or y2 == y:  # a step that would be corner-only: thicken
            chan.add((x + 1, y))
for (x, y) in chan:
    put(x, y, 'd', 0)
# fords (vehicle crossings): centre (road), inner pair, outer pair -- by distance along the wadi
def u(x, y): return x - y
FORDS = {0: 'r', 14: '.', -14: '.'}
for (x, y) in chan:
    for fu, sym in FORDS.items():
        if abs(u(x, y) - fu) <= 1:
            put(x, y, sym, 0)
# bed margins: low ground either side of the channel, with acacia cover and boulder bars
for y in range(N):
    for x in range(N):
        if g[y][x] == '.':
            dmin = min(abs(x - cx) + abs(y - cy) for (cx, cy) in chan)
            if dmin == 1: e[y][x] = 0
            if dmin == 1 and (x * 7 + y * 3) % 11 == 0: g[y][x] = 'o'
# --- the home shelf (seat 0's corner, NW): elevation 3, rear ridge and boulder flanks ----------
for y in range(N):
    for x in range(N):
        if x + y <= 20 and g[y][x] == '.': e[y][x] = 3
        elif x + y <= 24 and g[y][x] == '.': e[y][x] = 2
for i in range(0, 9):
    put(i, 0, '^', 4); put(0, i, '^', 4)
for (x, y) in [(1, 1), (2, 1), (1, 2)]: put(x, y, '^', 4)
for (x, y) in [(13, 1), (14, 1), (14, 2), (1, 13), (1, 14), (2, 14), (12, 2), (2, 12)]: put(x, y, 'b')
# shelf lip: cover knolls looking down the bank
for (x, y) in [(10, 12), (12, 10), (9, 13), (13, 9), (15, 7), (7, 15)]: put(x, y, 'n', 3)
# seat, camp, home zone
SEAT0 = (6, 6); CAMP0 = (4, 4)
put(*SEAT0, 'S'); put(*CAMP0, 'C')
# road: camp -> centre ford along the diagonal, and tracks to the two wells
for t in range(5, 20):
    if g[t][t] in '.o': put(t, t, 'r')
for x in range(7, 17):
    if g[3][x] == '.': put(x, 3, 'r')
for y in range(7, 14):
    if g[y][3] == '.': put(3, y, 'r')
# --- the wells (each seat's two near expansions): a walled farm, one house, on its own bank -----
def farm(x0, y0, hx, hy, gates):
    for x in range(x0, x0 + 4):
        put(x, y0, '='); put(x, y0 + 3, '=')
    for y in range(y0, y0 + 4):
        put(x0, y, '='); put(x0 + 3, y, '=')
    for x in range(x0 + 1, x0 + 3):
        for y in range(y0 + 1, y0 + 3): put(x, y, '.')
    for gx, gy in gates: put(gx, gy, '.')
    put(hx, hy, 'h')
farm(17, 2, 19, 3, [(17, 3), (18, 5)])   # north well (seat 0's), toward the NE mesa
farm(2, 14, 3, 16, [(3, 14), (5, 15)])   # west well (seat 0's), toward the SW mesa
# --- the NE mesa (contested flank, on the wadi's NE end): elevation 5, scree faces, one ramp ----
for y in range(N):
    for x in range(N):
        dx, dy = x - 35, y - 4
        r = math.hypot(dx, dy)
        if r <= 3.2 and g[y][x] in '.o':
            e[y][x] = 5
            if (x + y) % 3 == 0: put(x, y, 'n', 5)
        elif r <= 4.9 and g[y][x] in '.o':
            e[y][x] = 3
            put(x, y, 'b', 3)  # scree: a wall to wheels
# its ramp (vehicles up from seat 0's bank side and, by symmetry, the SW mesa's from seat 1's)
for (x, y) in [(31, 4), (31, 5), (32, 5), (35, 8), (34, 8), (34, 7)]: put(x, y, '.', 4)
put(35, 4, '^', 6); put(36, 4, '^', 6)  # the crown
# --- the inner tells (contested, near the inner fords): a small crown in a knoll field ----------
for (x, y) in [(23, 12), (24, 12)]: put(x, y, '^', 4)
for (x, y) in [(22, 11), (25, 11), (22, 13), (25, 13), (23, 10), (24, 14)]:
    if g[y][x] == '.': put(x, y, 'n', 3)
# --- the hamlet at the centre ford (Bir Sawda): single-storey only ------------------------------
for (x, y, c) in [(17, 18, 's'), (16, 17, 's'), (18, 16, 'p')]: put(x, y, c, 1)
# open plain scrub
for y in range(N):
    for x in range(N):
        if g[y][x] == '.' and (x * 13 + y * 7) % 23 == 0: put(x, y, '1')

# --- enforce half-turn symmetry: bottom half is the image of the top half ----------------------
for y in range(20, N):
    for x in range(N):
        g[y][x] = g[39 - y][39 - x]
        e[y][x] = e[39 - y][39 - x]
SEAT1 = (39 - SEAT0[0], 39 - SEAT0[1])

# --- checks ---------------------------------------------------------------------------------------
asym = sum(1 for y in range(N) for x in range(N) if g[y][x] != g[39 - y][39 - x] or e[y][x] != e[39 - y][39 - x])
FOOT_BLOCK = set('^shp=C')
VEH_BLOCK = FOOT_BLOCK | set('bd')
def bfs(start, block, extra_block=()):
    seen = {start}; q = collections.deque([(start, 0)]); dist = {start: 0}
    while q:
        (x, y), d = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < N and 0 <= ny < N and (nx, ny) not in seen and g[ny][nx] not in block and (nx, ny) not in extra_block:
                seen.add((nx, ny)); dist[(nx, ny)] = d + 1; q.append(((nx, ny), d + 1))
    return dist
foot = bfs(SEAT0, FOOT_BLOCK)
veh = bfs(SEAT0, VEH_BLOCK)
print(f'asymmetric cells: {asym}')
print(f'foot seat-to-seat: {foot.get(SEAT1)} cells; vehicle: {veh.get(SEAT1)} cells')
ford_cells = {}
for y in range(N):
    for x in range(N):
        if (x, y) in chan and g[y][x] in 'r.':
            for fu in FORDS:
                if abs(u(x, y) - fu) <= 1: ford_cells.setdefault(fu, []).append((x, y))
for fu, cells in sorted(ford_cells.items()):
    others = [c for k, v in ford_cells.items() if k != fu for c in v]
    alone = bfs(SEAT0, VEH_BLOCK, extra_block=set(others))
    print(f'ford u={fu:+d} cells {cells}: vehicle path with ONLY this ford open: {alone.get(SEAT1)}')
heads = [(x, y) for y in range(N) for x in range(N) if False]
nofords = bfs(SEAT0, VEH_BLOCK, extra_block=set(c for v in ford_cells.values() for c in v))
print(f'vehicle path with every ford shut: {nofords.get(SEAT1)}')
built = sum(1 for y in range(N) for x in range(N) if g[y][x] in 'shp')
walls = sum(1 for y in range(N) for x in range(N) if g[y][x] == '=')
opn = sum(1 for y in range(N) for x in range(N) if g[y][x] in '.1orS')
print(f'buildings {built} cells ({100*built/N/N:.1f}%), walls {walls}, open-ish {100*opn/N/N:.0f}%')
print('    ' + ''.join(str(i // 10) for i in range(N)))
print('    ' + ''.join(str(i % 10) for i in range(N)))
for y in range(N): print(f'{y:3d} ' + ''.join(g[y]))
print()
for y in range(N): print(f'{y:3d} ' + ''.join(str(v) for v in e[y]))

# --- zones overlay (tiles [x, y, w, h] on the 80x80 map; drawn at sketch scale) -----------------
ZONES0 = {  # seat-0 side and the NE/centre halves; the rest are their half-turn twins
    'home_0': ([6, 6, 12, 12], 'H', 20),
    'well_n_0': ([34, 4, 8, 8], 'W', 30),
    'well_w_0': ([4, 28, 8, 8], 'W', 30),
    'tell_ne': ([42, 20, 10, 10], 'T', 30),
    'mesa_ne': ([62, 0, 16, 16], 'M', 40),
    'centre': ([34, 34, 12, 12], 'X', 60),
}
def twin(z):
    x, y, w, h = z
    return [80 - x - w, 80 - y - h, w, h]
TWIN = {'home_0': 'home_1', 'well_n_0': 'well_s_1', 'well_w_0': 'well_e_1', 'tell_ne': 'tell_sw', 'mesa_ne': 'mesa_sw'}
zones = {}
for k, (z, c, r) in ZONES0.items():
    zones[k] = (z, c, r)
    if k in TWIN: zones[TWIN[k]] = (twin(z), c, r)
print()
ov = [[g[y][x] if g[y][x] in '^dSC' else ' ' for x in range(N)] for y in range(N)]
for k, (z, c, r) in zones.items():
    x, y, w, h = z
    for ty in range(y, y + h):
        for tx in range(x, x + w):
            ov[ty // 2][tx // 2] = c
for y in range(N): print(f'{y:3d} ' + ''.join(ov[y]))
tot = 0
for k, (z, c, r) in zones.items():
    print(f'{k:10s} {c} {z} {r}/min'); tot += r
print('total', tot)
