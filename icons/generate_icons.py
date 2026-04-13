import struct
import zlib

BG_TOP = (10, 102, 194)
BG_BOTTOM = (0, 65, 130)
WHITE = (255, 255, 255, 255)
GOLD = (255, 196, 61, 255)
TRANSPARENT = (0, 0, 0, 0)


def clamp(value, low=0, high=255):
    return max(low, min(high, int(value)))


def blend(src, dst):
    src_alpha = src[3] / 255.0
    dst_alpha = dst[3] / 255.0
    out_alpha = src_alpha + dst_alpha * (1 - src_alpha)
    if out_alpha <= 0:
        return (0, 0, 0, 0)
    out_r = (src[0] * src_alpha + dst[0] * dst_alpha * (1 - src_alpha)) / out_alpha
    out_g = (src[1] * src_alpha + dst[1] * dst_alpha * (1 - src_alpha)) / out_alpha
    out_b = (src[2] * src_alpha + dst[2] * dst_alpha * (1 - src_alpha)) / out_alpha
    return (clamp(out_r), clamp(out_g), clamp(out_b), clamp(out_alpha * 255))


def point_in_round_rect(x, y, left, top, right, bottom, radius):
    if left + radius <= x <= right - radius and top <= y <= bottom:
        return True
    if left <= x <= right and top + radius <= y <= bottom - radius:
        return True
    corners = [
        (left + radius, top + radius),
        (right - radius, top + radius),
        (left + radius, bottom - radius),
        (right - radius, bottom - radius),
    ]
    for cx, cy in corners:
        if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
            return True
    return False


def point_in_rect(x, y, left, top, right, bottom):
    return left <= x <= right and top <= y <= bottom


def point_in_circle(x, y, cx, cy, radius):
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def point_near_segment(x, y, ax, ay, bx, by, thickness):
    apx = x - ax
    apy = y - ay
    abx = bx - ax
    aby = by - ay
    length_sq = abx * abx + aby * aby
    if length_sq == 0:
        return apx * apx + apy * apy <= thickness * thickness
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / length_sq))
    px = ax + t * abx
    py = ay + t * aby
    return (x - px) ** 2 + (y - py) ** 2 <= thickness * thickness


def background_color(y, size):
    ratio = y / max(size - 1, 1)
    return (
        clamp(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * ratio),
        clamp(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * ratio),
        clamp(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * ratio),
        255,
    )


def icon_color(x, y, size):
    radius = size * 0.2
    if not point_in_round_rect(x, y, 0, 0, size - 1, size - 1, radius):
        return TRANSPARENT

    color = background_color(y, size)

    body_left = size * 0.2
    body_top = size * 0.34
    body_right = size * 0.8
    body_bottom = size * 0.76
    body_radius = size * 0.08
    if point_in_round_rect(x, y, body_left, body_top, body_right, body_bottom, body_radius):
        color = blend(WHITE, color)

    handle_left = size * 0.38
    handle_top = size * 0.22
    handle_right = size * 0.62
    handle_bottom = size * 0.38
    handle_radius = size * 0.05
    if point_in_round_rect(x, y, handle_left, handle_top, handle_right, handle_bottom, handle_radius):
        if not point_in_round_rect(
            x,
            y,
            handle_left + size * 0.05,
            handle_top + size * 0.05,
            handle_right - size * 0.05,
            handle_bottom + size * 0.02,
            handle_radius * 0.6,
        ):
            color = blend(WHITE, color)

    if point_in_rect(x, y, body_left, size * 0.5, body_right, size * 0.54):
        color = blend((221, 232, 243, 255), color)

    bars = [
        (size * 0.31, size * 0.6, size * 0.38, size * 0.69),
        (size * 0.43, size * 0.54, size * 0.5, size * 0.69),
        (size * 0.55, size * 0.47, size * 0.62, size * 0.69),
    ]
    for left, top, right, bottom in bars:
        if point_in_round_rect(x, y, left, top, right, bottom, size * 0.02):
            color = blend(GOLD, color)

    cx = size * 0.74
    cy = size * 0.3
    outer_radius = size * 0.12
    inner_radius = size * 0.075
    if point_in_circle(x, y, cx, cy, outer_radius) and not point_in_circle(x, y, cx, cy, inner_radius):
        color = blend(GOLD, color)

    if point_near_segment(x, y, size * 0.81, size * 0.37, size * 0.9, size * 0.46, size * 0.028):
        color = blend(GOLD, color)

    return color


def downsample(pixels, scale, size):
    output = []
    for y in range(size):
        row = []
        for x in range(size):
            red = green = blue = alpha = 0
            for sy in range(scale):
                for sx in range(scale):
                    pixel = pixels[(y * scale + sy) * size * scale + (x * scale + sx)]
                    red += pixel[0]
                    green += pixel[1]
                    blue += pixel[2]
                    alpha += pixel[3]
            count = scale * scale
            row.append((red // count, green // count, blue // count, alpha // count))
        output.append(row)
    return output


def write_png(filename, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for red, green, blue, alpha in row:
            raw.extend((red, green, blue, alpha))

    def chunk(tag, data):
        payload = tag + data
        return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    png.extend(chunk(b'IHDR', header))
    png.extend(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
    png.extend(chunk(b'IEND', b''))

    with open(filename, 'wb') as file_handle:
        file_handle.write(png)


def make_icon(size, filename, scale=6):
    high_res_size = size * scale
    pixels = [
        icon_color(x / scale, y / scale, size)
        for y in range(high_res_size)
        for x in range(high_res_size)
    ]
    image = downsample(pixels, scale, size)
    write_png(filename, image)


for icon_size in (16, 48, 128):
    make_icon(icon_size, f'icon{icon_size}.png')
    print(f'updated icon{icon_size}.png')
