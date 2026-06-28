"""
点源雷达波动画：从一个源点发射扩散波前，波前碰到矩形障碍物后产生回波。

这个脚本是面向可视化的雷达效果模型：
- 边界不反弹；
- 障碍物会产生回波；
- 波纹、光晕和颜色都稳定可控，便于用于前端/UE 贴图序列。
"""

import os

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap


DOMAIN_BOUNDS = {
    "x_min": -374.9009609222412,
    "x_max": 535.0990295410156,
    "y_min": -642.465877532959,
    "y_max": 287.53411769866943,
    "z_min": -40.00000059604645,
    "z_max": 755.0000190734863,
}

# 与运行时 Three.js 人物模型世界空间 AABB 一致（控制台 [人物模型 AABB] personReal，单位 cm）
PERSON_MODEL_AABB_CM = {
    "x_min": 197.60,
    "x_max": 283.55,
    "y_min": -191.84,
    "y_max": -8.99,
    "z_min": -8.97,
    "z_max": 22.12,
}


def _extract_xy_bounds(bounds):
    xmin, xmax = float(bounds["x_min"]), float(bounds["x_max"])
    ymin, ymax = float(bounds["y_min"]), float(bounds["y_max"])
    if xmin >= xmax or ymin >= ymax:
        raise ValueError(f"无效 XY 范围: x=({xmin}, {xmax}), y=({ymin}, {ymax})")
    return xmin, xmax, ymin, ymax


def _person_obstacle_center_xy(bounds):
    """障碍物中心 XY（cm）：人物网格 AABB 在 XY 上投影的中心，并约束在 DOMAIN 内。"""
    xmin, xmax, ymin, ymax = _extract_xy_bounds(bounds)
    ax = PERSON_MODEL_AABB_CM
    pcx = 0.5 * (float(ax["x_min"]) + float(ax["x_max"]))
    pcy = 0.5 * (float(ax["y_min"]) + float(ax["y_max"]))
    return (
        float(np.clip(pcx, xmin, xmax)),
        float(np.clip(pcy, ymin, ymax)),
    )


def _person_obstacle_size_xy_cm():
    """人物 AABB 在 XY 平面的边长（cm），用作障碍矩形宽高。"""
    ax = PERSON_MODEL_AABB_CM
    w = float(ax["x_max"]) - float(ax["x_min"])
    h = float(ax["y_max"]) - float(ax["y_min"])
    return max(w, 1e-6), max(h, 1e-6)


def _make_radar_cmap():
    return LinearSegmentedColormap.from_list(
        "radar_echo",
        [
            (0.00, "#031126"),
            (0.18, "#073a73"),
            (0.38, "#0a7fa3"),
            (0.66, "#2ecfc7"),
            (0.86, "#d6d884"),
            (1.00, "#dcefff"),
        ],
        N=256,
    )


def _gaussian_ring(distance, radius, width):
    return np.exp(-0.5 * ((distance - radius) / max(width, 1e-6)) ** 2)


def _smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _blur_rgb(img, radius):
    if radius <= 0:
        return img
    try:
        from PIL import Image, ImageFilter

        u8 = (np.clip(img, 0.0, 1.0) * 255 + 0.5).astype(np.uint8)
        pil = Image.fromarray(u8, mode="RGB")
        pil = pil.filter(ImageFilter.GaussianBlur(radius=radius))
        return np.asarray(pil).astype(np.float32) / 255.0
    except Exception:
        return img


def _rect_mask(X, Y, rect):
    x1, y1, x2, y2 = rect
    return (X >= x1) & (X <= x2) & (Y >= y1) & (Y <= y2)


def _hit_point_from_source_to_rect(source_x, source_y, rect):
    x1, y1, x2, y2 = rect
    hit_x = float(np.clip(source_x, x1, x2))
    hit_y = y2 if source_y >= (y1 + y2) * 0.5 else y1
    return hit_x, hit_y


def _return_lobe(X, Y, hit_x, hit_y, source_x, source_y, softness=0.55):
    """回波主要朝源点方向更亮，仍保留少量散射。"""
    vx = source_x - hit_x
    vy = source_y - hit_y
    vlen = np.hypot(vx, vy) + 1e-9
    vx, vy = vx / vlen, vy / vlen

    px = X - hit_x
    py = Y - hit_y
    plen = np.hypot(px, py) + 1e-9
    dot = (px / plen) * vx + (py / plen) * vy
    return 0.18 + 0.82 * _smoothstep(-softness, 1.0, dot)


def generate_custom_radar(width=910, height=795, frames=60, output_dir="sim", bounds=None):
    bounds = DOMAIN_BOUNDS if bounds is None else bounds
    xmin, xmax, ymin, ymax = _extract_xy_bounds(bounds)

    xspan = xmax - xmin
    yspan = ymax - ymin
    cx = (xmin + xmax) * 0.5
    cy = (ymin + ymax) * 0.5
    max_span = max(xspan, yspan)

    # 可调参数：源点、可穿透墙在域内；障碍物中心与尺寸 = 人物模型世界 AABB 在 XY 的投影（cm）
    source_x = cx
    source_y = ymin + 0.10 * yspan
    obstacle_w, obstacle_h = _person_obstacle_size_xy_cm()
    obstacle_cx, obstacle_cy = _person_obstacle_center_xy(bounds)
    obstacle_rect = (
        obstacle_cx - obstacle_w * 0.5,
        obstacle_cy - obstacle_h * 0.5,
        obstacle_cx + obstacle_w * 0.5,
        obstacle_cy + obstacle_h * 0.5,
    )
    penetrable_walls = [
        (xmin, ymin + 0.52 * yspan, xmax, ymin + 0.60 * yspan, np.array([0.24, 0.48, 0.78], dtype=np.float32), 0.82),
        (xmin, ymin + 0.60 * yspan, xmax, ymin + 0.69 * yspan, np.array([0.58, 0.64, 0.70], dtype=np.float32), 0.76),
        (xmin, ymin + 0.69 * yspan, xmax, ymin + 0.78 * yspan, np.array([0.55, 0.26, 0.25], dtype=np.float32), 0.70),
    ]

    hit_x, hit_y = _hit_point_from_source_to_rect(source_x, source_y, obstacle_rect)
    hit_dist = float(np.hypot(hit_x - source_x, hit_y - source_y))
    # 显示用回波从撞击点生成，避免镜像源圆心把可见回波带到障碍后方。

    wave_speed = max_span / 34.0
    ring_width = max_span / 135.0
    tail_width = ring_width * 4.2
    pulse_gap = 24.0
    pulse_offsets = [0.0, pulse_gap, pulse_gap * 2.0]
    echo_width = ring_width * 1.25
    echo_gain = 0.88

    cmap = _make_radar_cmap()
    os.makedirs(output_dir, exist_ok=True)

    dpi = 100
    fig, ax = plt.subplots(figsize=(width / dpi, height / dpi), dpi=dpi, facecolor="#020712")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

    x = np.linspace(xmin, xmax, width, dtype=np.float32)
    y = np.linspace(ymin, ymax, height, dtype=np.float32)
    X, Y = np.meshgrid(x, y)

    dist_source = np.hypot(X - source_x, Y - source_y)
    dist_hit = np.hypot(X - hit_x, Y - hit_y)
    obstacle_mask = _rect_mask(X, Y, obstacle_rect)
    wall_masks = [_rect_mask(X, Y, wall[:4]) for wall in penetrable_walls]
    upward_emit = _smoothstep(source_y - ring_width * 1.2, source_y + ring_width * 2.2, Y)
    block_side = Y >= obstacle_rect[3]
    hard_block_gate = block_side.astype(np.float32) * np.exp(
        -((X - obstacle_cx) / (obstacle_w * 0.62)) ** 6
    )
    # 底面反射：回波只应出现在底面以下（靠近源点一侧），障碍上方不应出现假月牙。
    y_face = float(obstacle_rect[1])
    echo_downgate = (
        1.0
        - _smoothstep(
            y_face + ring_width * 2.0,
            y_face + ring_width * 22.0,
            Y,
        )
    ).astype(np.float32)
    aperture_x = np.exp(
        -0.5
        * (
            np.maximum(np.abs(X - obstacle_cx) - obstacle_w * 0.42, 0.0)
            / (obstacle_w * 0.22 + 1e-9)
        )
        ** 2
    )
    outside_obstacle = (~obstacle_mask).astype(np.float32)
    return_lobe = _return_lobe(X, Y, hit_x, hit_y, source_x, source_y).astype(np.float32)

    center_r = np.hypot(X - cx, Y - cy) / (np.hypot(xspan, yspan) * 0.5)
    vignette = np.clip(1.0 - 0.35 * center_r**1.8, 0.55, 1.0)

    transmission = np.ones((height, width), dtype=np.float32)
    for wall in penetrable_walls:
        _, _, _, wall_y2, _, pass_ratio = wall
        passed_wall = Y >= wall_y2 if source_y < wall_y2 else Y <= wall[1]
        transmission[passed_wall] *= pass_ratio

    print(
        f"生成雷达波: 源=({source_x:.1f},{source_y:.1f}) "
        f"障碍中心(人物AABB,cm)=({obstacle_cx:.1f},{obstacle_cy:.1f}) "
        f"障碍尺寸 WxH(cm)={obstacle_w:.1f}x{obstacle_h:.1f} "
        f"障碍框=({obstacle_rect[0]:.1f},{obstacle_rect[1]:.1f})~"
        f"({obstacle_rect[2]:.1f},{obstacle_rect[3]:.1f}) "
        f"回波点=({hit_x:.1f},{hit_y:.1f}) -> {output_dir}/"
    )

    for frame in range(frames):
        intensity = np.zeros((height, width), dtype=np.float32)

        for offset in pulse_offsets:
            age = frame - offset
            if age < 0:
                continue

            radius = age * wave_speed
            if radius > max_span * 1.35:
                continue

            direct_front = _gaussian_ring(dist_source, radius, ring_width)
            direct_tail = np.exp(-np.maximum(radius - dist_source, 0.0) / tail_width)
            direct_tail *= dist_source <= radius
            direct = direct_front * 1.15 + direct_tail * 0.18
            direct *= np.exp(-dist_source / (max_span * 0.95))
            direct *= upward_emit
            direct *= transmission

            # 硬障碍中心区域不透波；边缘保留少量绕射，避免视觉上被矩形硬切。
            shadow = 1.0 - 0.92 * hard_block_gate
            intensity += direct * shadow

            echo_r = radius - hit_dist
            if echo_r > 0:
                # 回波从障碍底面的撞击点产生，只在朝源点返回的一侧增强。
                echo_front = _gaussian_ring(dist_hit, echo_r, echo_width)
                echo_tail = np.exp(-np.maximum(echo_r - dist_hit, 0.0) / (tail_width * 0.88))
                echo_tail *= dist_hit <= echo_r
                echo = (
                    echo_front * echo_gain
                    + echo_tail * (0.10 * aperture_x.astype(np.float32))
                )
                echo *= aperture_x.astype(np.float32) * echo_downgate * outside_obstacle * return_lobe
                echo *= transmission
                echo *= np.exp(-dist_hit / (max_span * 0.92))
                intensity += echo

        source_glow = np.exp(-(dist_source / (ring_width * 2.4)) ** 2) * 0.42
        intensity += source_glow

        obstacle_flash = 0.0
        for offset in pulse_offsets:
            age = frame - offset
            if age >= 0:
                obstacle_flash += float(_gaussian_ring(np.array(hit_dist), age * wave_speed, ring_width * 1.8))
        obstacle_flash = min(obstacle_flash, 1.0)

        intensity = np.clip(intensity * 0.78, 0.0, 1.0) ** 0.82

        rgb = cmap(intensity)[..., :3].astype(np.float32)
        bg = np.array([0.015, 0.07, 0.17], dtype=np.float32)
        display = bg[None, None, :] * (0.52 + 0.48 * vignette[..., None]) + rgb * 1.05
        display = np.clip(display, 0.0, 1.0)

        for wall, wall_mask in zip(penetrable_walls, wall_masks):
            wall_color = wall[4]
            wall_wave = intensity[wall_mask][..., None]
            wall_highlight = np.array([0.58, 0.82, 0.90], dtype=np.float32)
            display[wall_mask] = (
                display[wall_mask] * (0.70 + 0.28 * wall_wave)
                + wall_color * 0.22
                + wall_highlight * (0.22 * wall_wave)
            )
            display[wall_mask] = np.clip(display[wall_mask], 0.0, 1.0)

        obstacle_color = np.array([0.52, 0.08, 0.11], dtype=np.float32)
        obstacle_hit_color = np.array([1.0, 0.35, 0.18], dtype=np.float32)
        display[obstacle_mask] = obstacle_color * (1.0 - obstacle_flash) + obstacle_hit_color * obstacle_flash

        display = _blur_rgb(display, 0.55)

        ax.clear()
        ax.set_axis_off()
        ax.imshow(display, extent=(xmin, xmax, ymin, ymax), origin="lower", interpolation="bilinear")
        ax.plot(
            source_x,
            source_y,
            "o",
            ms=3.2,
            mfc="#eaffff",
            mec="#69d6ff",
            mew=0.35,
            alpha=0.8,
            zorder=5,
        )

        filename = os.path.join(output_dir, f"frame_{frame:03d}.png")
        plt.savefig(filename, dpi=dpi, facecolor=fig.get_facecolor(), pad_inches=0)

        if frame % 12 == 0:
            print(f"  ... {frame}/{frames}")

    plt.close(fig)
    print(f"完成: {os.path.abspath(output_dir)}")


if __name__ == "__main__":
    generate_custom_radar()
    raise SystemExit
_OLD_UNUSED = r'''
点源雷达波动画：从一个源点发射扩散波前，波前碰到矩形障碍物后产生回波。

这个脚本不是通用波动方程求解器，而是面向可视化的雷达效果模型：
- 边界不反弹；
- 障碍物会产生回波；
- 波纹、光晕和颜色都稳定可控，便于用于前端/UE 贴图序列。
"""

import os

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap


DOMAIN_BOUNDS = {
    "x_min": -374.9009609222412,
    "x_max": 535.0990295410156,
    "y_min": -642.465877532959,
    "y_max": 287.53411769866943,
    "z_min": -40.00000059604645,
    "z_max": 755.0000190734863,
}


def _extract_xy_bounds(bounds):
    xmin, xmax = float(bounds["x_min"]), float(bounds["x_max"])
    ymin, ymax = float(bounds["y_min"]), float(bounds["y_max"])
    if xmin >= xmax or ymin >= ymax:
        raise ValueError(f"无效 XY 范围: x=({xmin}, {xmax}), y=({ymin}, {ymax})")
    return xmin, xmax, ymin, ymax


def _make_radar_cmap():
    return LinearSegmentedColormap.from_list(
        "radar_echo",
        [
            (0.00, "#031126"),
            (0.18, "#073a73"),
            (0.38, "#0ba8c8"),
            (0.66, "#58ffe8"),
            (0.86, "#fff28c"),
            (1.00, "#ffffff"),
        ],
        N=256,
    )


def _gaussian_ring(distance, radius, width):
    """半径 radius 处的柔和亮环。"""
    return np.exp(-0.5 * ((distance - radius) / max(width, 1e-6)) ** 2)


def _smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _blur_rgb(img, radius):
    if radius <= 0:
        return img
    try:
        from PIL import Image, ImageFilter

        u8 = (np.clip(img, 0.0, 1.0) * 255 + 0.5).astype(np.uint8)
        pil = Image.fromarray(u8, mode="RGB")
        pil = pil.filter(ImageFilter.GaussianBlur(radius=radius))
        return np.asarray(pil).astype(np.float32) / 255.0
    except Exception:
        return img


def _rect_mask(X, Y, rect):
    x1, y1, x2, y2 = rect
    return (X >= x1) & (X <= x2) & (Y >= y1) & (Y <= y2)


def _hit_point_from_source_to_rect(source_x, source_y, rect):
    """取源点到矩形最近的一点，作为回波发射点。"""
    x1, y1, x2, y2 = rect
    hit_x = float(np.clip(source_x, x1, x2))
    hit_y = y2 if source_y >= (y1 + y2) * 0.5 else y1
    return hit_x, hit_y


def _return_lobe(X, Y, hit_x, hit_y, source_x, source_y, softness=0.55):
    """
    让回波主要朝源点方向亮一些，仍保留少量向四周散射的能量。
    返回值范围约 0.15~1。
    """
    vx = source_x - hit_x
    vy = source_y - hit_y
    vlen = np.hypot(vx, vy) + 1e-9
    vx, vy = vx / vlen, vy / vlen

    px = X - hit_x
    py = Y - hit_y
    plen = np.hypot(px, py) + 1e-9
    dot = (px / plen) * vx + (py / plen) * vy
    return 0.18 + 0.82 * _smoothstep(-softness, 1.0, dot)


def generate_custom_radar(width=800, height=600, frames=72, output_dir="sim", bounds=None):
    bounds = DOMAIN_BOUNDS if bounds is None else bounds
    xmin, xmax, ymin, ymax = _extract_xy_bounds(bounds)

    xspan = xmax - xmin
    yspan = ymax - ymin
    cx = (xmin + xmax) * 0.5
    cy = (ymin + ymax) * 0.5
    max_span = max(xspan, yspan)

    # 可调参数：源点与障碍物都放在你给的 XY 范围内。
    source_x = cx
    source_y = ymax - 0.12 * yspan
    obstacle_w = 0.14 * xspan
    obstacle_h = 0.055 * yspan
    obstacle_rect = (
        cx - obstacle_w * 0.5,
        cy - obstacle_h * 0.5,
        cx + obstacle_w * 0.5,
        cy + obstacle_h * 0.5,
    )

    hit_x, hit_y = _hit_point_from_source_to_rect(source_x, source_y, obstacle_rect)
    hit_dist = float(np.hypot(hit_x - source_x, hit_y - source_y))

    wave_speed = max_span / 34.0
    ring_width = max_span / 135.0
    tail_width = ring_width * 4.2
    pulse_gap = 24.0
    pulse_offsets = [0.0, pulse_gap, pulse_gap * 2.0]

    echo_delay = 0.0
    echo_width = ring_width * 1.25
    echo_gain = 1.35

    cmap = _make_radar_cmap()
    os.makedirs(output_dir, exist_ok=True)

    dpi = 100
    fig, ax = plt.subplots(figsize=(width / dpi, height / dpi), dpi=dpi, facecolor="#020712")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

    x = np.linspace(xmin, xmax, width, dtype=np.float32)
    y = np.linspace(ymin, ymax, height, dtype=np.float32)
    X, Y = np.meshgrid(x, y)

    dist_source = np.hypot(X - source_x, Y - source_y)
    dist_echo = np.hypot(X - hit_x, Y - hit_y)
    obstacle_mask = _rect_mask(X, Y, obstacle_rect)
    lobe = _return_lobe(X, Y, hit_x, hit_y, source_x, source_y)

    # 轻微暗角：画面中心亮，四角暗，但不是“墙”。
    center_r = np.hypot(X - cx, Y - cy) / (np.hypot(xspan, yspan) * 0.5)
    vignette = np.clip(1.0 - 0.35 * center_r**1.8, 0.55, 1.0)

    print(
        f"生成雷达波: 源=({source_x:.1f},{source_y:.1f}) "
        f"障碍=({obstacle_rect[0]:.1f},{obstacle_rect[1]:.1f})~"
        f"({obstacle_rect[2]:.1f},{obstacle_rect[3]:.1f}) "
        f"回波点=({hit_x:.1f},{hit_y:.1f}) -> {output_dir}/"
    )

    for frame in range(frames):
        intensity = np.zeros((height, width), dtype=np.float32)

        for offset in pulse_offsets:
            age = frame - offset
            if age < 0:
                continue

            radius = age * wave_speed
            if radius > max_span * 1.35:
                continue

            direct_front = _gaussian_ring(dist_source, radius, ring_width)
            direct_tail = np.exp(-np.maximum(radius - dist_source, 0.0) / tail_width)
            direct_tail *= dist_source <= radius

            # 源波：明亮前沿 + 柔和拖尾。
            direct = direct_front * 1.15 + direct_tail * 0.18
            direct *= np.exp(-dist_source / (max_span * 0.95))

            # 障碍物后方略暗，表现遮挡，不做边界反射。
            shadow = np.ones_like(intensity)
            behind_obstacle = (Y < obstacle_rect[1]) & (np.abs(X - cx) < obstacle_w * 0.8)
            shadow[behind_obstacle] *= 0.65
            intensity += direct * shadow

            # 回波：当源波到达障碍物后，从命中点发出回波。
            echo_age_dist = radius - hit_dist - echo_delay
            if echo_age_dist > 0:
                echo_front = _gaussian_ring(dist_echo, echo_age_dist, echo_width)
                echo_tail = np.exp(-np.maximum(echo_age_dist - dist_echo, 0.0) / (tail_width * 0.85))
                echo_tail *= dist_echo <= echo_age_dist
                echo = (echo_front * echo_gain + echo_tail * 0.16) * lobe
                echo *= np.exp(-dist_echo / (max_span * 0.78))
                intensity += echo

        # 点源附近保留一点能量光斑。
        source_glow = np.exp(-(dist_source / (ring_width * 2.4)) ** 2) * 0.42
        intensity += source_glow

        # 障碍被主波扫到时变亮，表示被探测到。
        obstacle_flash = 0.0
        for offset in pulse_offsets:
            age = frame - offset
            if age >= 0:
                obstacle_flash += float(_gaussian_ring(np.array(hit_dist), age * wave_speed, ring_width * 1.8))
        obstacle_flash = min(obstacle_flash, 1.0)

        intensity = np.clip(intensity, 0.0, 1.0)
        intensity = intensity**0.72

        rgb = cmap(intensity)[..., :3].astype(np.float32)
        bg = np.array([0.015, 0.07, 0.17], dtype=np.float32)
        display = bg[None, None, :] * (0.45 + 0.55 * vignette[..., None]) + rgb * 1.55
        display = np.clip(display, 0.0, 1.0)

        # 障碍物：暗红底，命中时边缘发亮。
        obstacle_color = np.array([0.52, 0.08, 0.11], dtype=np.float32)
        obstacle_hit_color = np.array([1.0, 0.35, 0.18], dtype=np.float32)
        display[obstacle_mask] = (
            obstacle_color * (1.0 - obstacle_flash) + obstacle_hit_color * obstacle_flash
        )

        display = _blur_rgb(display, 0.55)

        ax.clear()
        ax.set_axis_off()
        ax.imshow(display, extent=(xmin, xmax, ymin, ymax), origin="lower", interpolation="bilinear")
        ax.plot(
            source_x,
            source_y,
            "o",
            ms=3.2,
            mfc="#eaffff",
            mec="#69d6ff",
            mew=0.35,
            alpha=0.8,
            zorder=5,
        )

        filename = os.path.join(output_dir, f"frame_{frame:03d}.png")
        plt.savefig(filename, dpi=dpi, facecolor=fig.get_facecolor(), pad_inches=0)

        if frame % 12 == 0:
            print(f"  ... {frame}/{frames}")

    plt.close(fig)
    print(f"完成: {os.path.abspath(output_dir)}")


if __name__ == "__main__":
    generate_custom_radar()
'''
_OLD_UNUSED_2 = r'''
雷达波仿真：在 XY 包围盒内点源发射；矩形障碍物上保留反射；四周外行波吸收，
外边界不出现明显「弹回」（零 ghost Laplacian + 厚海绵层）。

近似 2D 波动方程 ∂²u/∂t² = c²Δu；障碍邻向镜像近似 Neumann 反射；
外边界不向域内镜面反弹。依赖 numpy、matplotlib；建议 Pillow、scipy。
"""

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import os


DOMAIN_BOUNDS = {
    "x_min": -374.9009609222412,
    "x_max": 535.0990295410156,
    "y_min": -642.465877532959,
    "y_max": 287.53411769866943,
    "z_min": -40.00000059604645,
    "z_max": 755.0000190734863,
}


def _extract_xy_bounds(bounds):
    xm, xX = float(bounds["x_min"]), float(bounds["x_max"])
    ym, yX = float(bounds["y_min"]), float(bounds["y_max"])
    if not (xm < xX and ym < yX):
        raise ValueError(f"无效的 XY 包围盒：x=({xm},{xX}), y=({ym},{yX})")
    return xm, xX, ym, yX


def _make_tone_cmap():
    return LinearSegmentedColormap.from_list(
        "radar_wave",
        [
            (0.00, "#062040"),
            (0.20, "#0c4f8f"),
            (0.42, "#1ab8cf"),
            (0.72, "#73fff0"),
            (1.00, "#ffffff"),
        ],
        N=256,
    )


def _pil_resize_gray_chan(g, ow, oh):
    try:
        from PIL import Image

        gu = (np.clip(g, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
        pil = Image.fromarray(gu, mode="L")
        pil = pil.resize((ow, oh), Image.Resampling.LANCZOS)
        return np.asarray(pil).astype(np.float32) / 255.0
    except Exception:
        try:
            import scipy.ndimage as nd

            zi = oh / float(g.shape[0])
            zj = ow / float(g.shape[1])
            return nd.zoom(g, (zi, zj), order=3)
        except Exception:
            h, w = g.shape
            out = np.zeros((oh, ow), dtype=np.float32)
            for ii in range(oh):
                for jj in range(ow):
                    u = ii / max(oh - 1, 1) * (h - 1)
                    v = jj / max(ow - 1, 1) * (w - 1)
                    ia, ib = int(u), min(int(np.ceil(u)), h - 1)
                    ja, jb = int(v), min(int(np.ceil(v)), w - 1)
                    tu, tv = u - ia, v - ja
                    oa = (
                        g[ia, ja] * (1 - tu) * (1 - tv)
                        + g[ia, jb] * (1 - tu) * tv
                        + g[ib, ja] * tu * (1 - tv)
                        + g[ib, jb] * tu * tv
                    )
                    out[ii, jj] = oa
            return out


def _blur_gray(g, sigma):
    if sigma < 0.15:
        return g
    try:
        import scipy.ndimage as nd

        return nd.gaussian_filter(g.astype(np.float64), sigma).astype(np.float32)
    except Exception:
        return g


def _blur_rgb(img, radius):
    if radius <= 0.05:
        return img
    try:
        from PIL import Image, ImageFilter

        u8 = (np.clip(img, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
        pil = Image.fromarray(u8, mode="RGB")
        pil = pil.filter(ImageFilter.GaussianBlur(radius=max(1, round(radius))))
        return np.asarray(pil).astype(np.float32) / 255.0
    except Exception:
        return img


def _lap_obstacle_reflect_outer_absorb(U, OBS, dx):
    """
    外层一圈 ghost 固定为 0（真空 / 外行波），不向计算域内侧「弹回」；
    仅在障碍物上使用邻向镜像，保留障碍处的反射。
    """
    h, w = U.shape
    P = np.zeros((h + 2, w + 2), dtype=np.float64)
    P[1:-1, 1:-1] = U
    B = np.pad(OBS.astype(bool), 1, mode="constant", constant_values=False)
    cen = P[1:-1, 1:-1]

    nu = np.where(B[2:, 1:-1], cen, P[2:, 1:-1])
    nd = np.where(B[:-2, 1:-1], cen, P[:-2, 1:-1])
    nr = np.where(B[1:-1, 2:], cen, P[1:-1, 2:])
    nl = np.where(B[1:-1, :-2], cen, P[1:-1, :-2])

    return (nu + nd + nl + nr - 4.0 * cen) / (dx * dx)


def generate_custom_radar(width=800, height=600, frames=72, output_dir="sim", bounds=None):
    b = bounds if bounds is not None else DOMAIN_BOUNDS
    xmin, xmax, ymin, ymax = _extract_xy_bounds(b)
    zx1 = float(b.get("z_min", 0.0))
    zx2 = float(b.get("z_max", 0.0))

    xspan = xmax - xmin
    yspan = ymax - ymin
    cx = 0.5 * (xmin + xmax)
    cy = 0.5 * (ymin + ymax)

    SRC_X, SRC_Y = cx, ymax - 0.10 * yspan

    OBS_HALF_W = xspan * 0.068
    OBS_HALF_H = yspan * 0.026
    OBS_RECT = (cx - OBS_HALF_W, cy - OBS_HALF_H, cx + OBS_HALF_W, cy + OBS_HALF_H)

    cmap = _make_tone_cmap()
    OBS_RGB = np.array([0.52, 0.11, 0.15], dtype=np.float32)

    dpi = 100
    os.makedirs(output_dir, exist_ok=True)

    aspect = yspan / xspan
    cap = 640
    phy_w = min(width, cap)
    phy_h = int(round(phy_w * aspect))
    if phy_h > min(height, cap):
        phy_h = min(height, cap)
        phy_w = int(max(300, round(phy_h / aspect)))
    phy_w = int(max(300, min(width, phy_w)))
    phy_h = int(max(300, min(height, phy_h)))

    gx = np.linspace(xmin, xmax, phy_w, dtype=np.float64)
    gy = np.linspace(ymin, ymax, phy_h, dtype=np.float64)
    GX, GY = np.meshgrid(gx, gy)

    obs = (
        (GX >= OBS_RECT[0])
        & (GX <= OBS_RECT[2])
        & (GY >= OBS_RECT[1])
        & (GY <= OBS_RECT[3])
    ).astype(np.float64)
    fluid = ~(obs.astype(bool))

    spongew = max(48, int(0.16 * min(phy_w, phy_h)))
    iy = np.arange(phy_h, dtype=np.float64)[:, None]
    jx = np.arange(phy_w, dtype=np.float64)[None, :]
    sph_dist = np.minimum(np.minimum(iy, phy_h - 1 - iy), np.minimum(jx, phy_w - 1 - jx))
    spoil = np.clip(1.0 - sph_dist / float(spongew), 0.0, 1.0)
    absorb = np.exp(-3.2 * np.power(spoil, 1.85))

    x_to_i = (SRC_X - xmin) / (xmax - xmin) * (phy_w - 1)
    y_to_j = (SRC_Y - ymin) / (ymax - ymin) * (phy_h - 1)
    si_m = float(np.clip(x_to_i, 2.0, phy_w - 3))
    sj_m = float(np.clip(y_to_j, 2.0, phy_h - 3))
    si0, si1 = int(np.floor(si_m)), int(np.ceil(si_m))
    sj0, sj1 = int(np.floor(sj_m)), int(np.ceil(sj_m))
    wx, wy = si_m - si0, sj_m - sj0

    c_scale = np.sqrt(max(xspan * yspan, 1e-6)) / 550.0
    c = 1180.0 * max(c_scale, 0.65)
    dx = float(xspan / max(phy_w - 1, 1))
    courant = 0.40
    dt = courant * dx / (c * np.sqrt(2.0))
    coef = (c * c) * (dt * dt)
    steps_per_frame = 36

    # 发射角频率 ~ c/λ（λ 为数格波长），太低看不见环，太高会数值发糊
    wave_len = max(dx * 9.5, min(xspan, yspan) * 0.028)
    source_omega = 2.0 * np.pi * c / wave_len

    u = np.zeros((phy_h, phy_w), dtype=np.float64)
    up = np.zeros_like(u)
    t_accum = 0.0

    xf = np.linspace(xmin, xmax, width)
    yf = np.linspace(ymin, ymax, height)
    X_full, Y_full = np.meshgrid(xf, yf)
    obs_hi = (
        (X_full >= OBS_RECT[0])
        & (X_full <= OBS_RECT[2])
        & (Y_full >= OBS_RECT[1])
        & (Y_full <= OBS_RECT[3])
    )
    r_center = np.hypot(X_full - SRC_X, Y_full - SRC_Y)
    vmax_r = np.hypot(xspan * 0.55, yspan * 0.55)

    amp_ema = None
    cmap_lo = np.asarray(cmap(0.0), dtype=np.float32)[:3]

    fig, ax = plt.subplots(figsize=(width / dpi, height / dpi), dpi=dpi, facecolor="#03060c")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

    print(
        f"波动仿真 X∈[{xmin:.2f},{xmax:.2f}] Y∈[{ymin:.2f},{ymax:.2f}] · Z[{zx1:.1f},{zx2:.1f}]（记录） · "
        f"源 ({SRC_X:.1f},{SRC_Y:.1f}) · 网格 {phy_w}×{phy_h} → 输出 {width}×{height} · {frames} 帧"
    )

    for frame in range(frames):
        for _ in range(steps_per_frame):
            lap = _lap_obstacle_reflect_outer_absorb(u, obs.astype(bool), dx)
            un = np.zeros_like(u)
            un[1:-1, 1:-1] = 2.0 * u[1:-1, 1:-1] - up[1:-1, 1:-1] + coef * lap[1:-1, 1:-1]
            un[obs.astype(bool)] = 0.0

            t_accum += dt
            ramp = min(1.0, t_accum / (28.0 * dt))
            inj = ramp * np.sin(source_omega * t_accum) * (48000.0 * (dt * dt))
            for ii, wxx in ((si0, 1.0 - wx), (si1, wx)):
                for jj, wyy in ((sj0, 1.0 - wy), (sj1, wy)):
                    if 0 <= ii < phy_w and 0 <= jj < phy_h and fluid[jj, ii]:
                        un[jj, ii] += inj * wxx * wyy

            un *= absorb
            up, u = u, un

        mag_lr = np.abs(u - np.mean(u[~obs.astype(bool)]))
        mag_lr = np.nan_to_num(mag_lr, nan=0.0, posinf=0.0)

        fv = mag_lr.ravel()[fluid.ravel()]
        if fv.size < 500:
            hi = float(np.percentile(mag_lr, 99.9)) + 1e-12
            lo = 0.0
        else:
            lo = float(np.percentile(fv, 28.0))
            hi = float(np.percentile(fv, 99.75)) + 1e-12

        rng = hi - lo
        if rng < hi * 0.035 + 1e-10:
            lo = float(max(0.0, hi * 0.35 - rng * 0.5))
            rng = max(hi - lo, hi * 0.045 + 1e-12)

        if amp_ema is None:
            amp_ema = hi
        amp_ema = max(1e-10, 0.78 * amp_ema + 0.22 * hi)
        rng *= 0.55 + 0.45 * (hi / amp_ema)

        raw = np.clip((mag_lr - lo) / rng, 0.0, 1.0)
        raw = np.power(raw, 0.48)

        sigma_lr = max(0.75, phy_w / 620.0 * 1.9)
        raw = _blur_gray(raw.astype(np.float32), sigma=sigma_lr)

        n_hi = _pil_resize_gray_chan(raw, width, height)
        bump = np.exp(-np.square(r_center / max(vmax_r * 0.42, 1.0))) * 0.18
        n_hi = np.clip(n_hi * (0.88 + bump) + _blur_gray(n_hi, 0.95) * 0.09, 0.0, 1.08)
        n_hi = np.power(np.clip(n_hi, 0.0, 1.0), 0.93)

        rgba = cmap(np.clip(n_hi, 0.0, 1.0).astype(np.float64))
        glow = rgba[..., :3].astype(np.float32)
        glow[..., 1] = np.minimum(1.0, glow[..., 1] * 1.06)
        glow[..., 2] = np.minimum(1.0, glow[..., 2] * 1.04)

        vignette = np.clip(
            0.82 + 0.18 * (1.05 - np.power(r_center / max(vmax_r * 1.05, 1.0), 1.85)),
            0.68,
            1.07,
        )[..., None]

        hi_bg = cmap_lo.copy()
        radial_dim = np.clip(0.94 - 0.18 * np.power(np.clip(r_center / vmax_r, 0.0, 1.05), 1.55), 0.7, 1.0)[
            ..., None
        ]
        display = hi_bg[None, None, :] * radial_dim * 0.22 + glow * vignette * 1.72
        display = np.clip(display, 0.0, 1.0)

        display[obs_hi] = OBS_RGB

        display = _blur_rgb(display, 1.05)

        ax.clear()
        ax.set_axis_off()
        ax.imshow(display, extent=(xmin, xmax, ymin, ymax), origin="lower", interpolation="bilinear")
        ax.plot(SRC_X, SRC_Y, "o", ms=2.1, mfc="#d6faff", mec="#4a93b8", mew=0.2, alpha=0.4, zorder=5)

        plt.savefig(
            os.path.join(output_dir, f"frame_{frame:03d}.png"),
            dpi=dpi,
            facecolor=fig.get_facecolor(),
            pad_inches=0,
        )
        if frame % 12 == 0:
            print(f"  … {frame}/{frames}")

    plt.close(fig)
    print(f"完成：{os.path.abspath(output_dir)}")


if __name__ == "__main__":
    generate_custom_radar()
'''
