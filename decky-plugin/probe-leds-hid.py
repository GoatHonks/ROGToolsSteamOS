#!/usr/bin/env python3
"""Verify the ASUS Ally RGB *HID* path (needed for Phase-2 effects) BEFORE we
build it into the plugin. It finds the /dev/hidraw tied to the same HID device as
the `ally:rgb` LED node (so it's guaranteed the RGB-control interface, no
guessing), then sends a RAINBOW effect and then SOLID GREEN so you can watch.

Safe: it only writes LED output reports (exactly what HueSync/hhd do) — no driver
unbind, nothing on the boot path. Run:  sudo python3 probe-leds-hid.py
Afterwards, set a colour in the plugin (or re-run) to restore your normal state.
"""
import glob
import os
import sys
import time


def find_led_node():
    for d in sorted(glob.glob("/sys/class/leds/*/")):
        d = d.rstrip("/")
        if os.path.exists(os.path.join(d, "multi_intensity")) and "rgb" in os.path.basename(d):
            return d
    return None


def find_hidraw(led_node):
    hid_dev = os.path.realpath(os.path.join(led_node, "device"))
    # hidraw sibling under the same HID device (0003:0B05:1B4C.xxxx)
    for h in glob.glob(os.path.join(hid_dev, "hidraw", "hidraw*")):
        return "/dev/" + os.path.basename(h)
    # fallbacks: same interface subtree
    for base in (hid_dev, os.path.dirname(hid_dev)):
        for h in glob.glob(os.path.join(base, "**", "hidraw", "hidraw*"), recursive=True):
            return "/dev/" + os.path.basename(h)
    return None


def buf(data):
    b = bytearray(64)
    b[: len(data)] = bytes(data)
    return bytes(b)


RGB_INIT = [0x5A, 0x41, 0x53, 0x55, 0x53, 0x20, 0x54, 0x65, 0x63, 0x68, 0x2E, 0x49, 0x6E, 0x63, 0x2E]
RGB_SET = [0x5A, 0xB5]
RGB_APPLY = [0x5A, 0xB4]
ZONE_ALL = 0x00
MODE = {"solid": 0x00, "pulse": 0x01, "rainbow": 0x02, "spiral": 0x03}


def config_rgb(val=0x02):
    return [0x5A, 0xD1, 0x09, 0x01, val]


def brightness(level):  # 0..3
    return [0x5A, 0xBA, 0xC5, 0xC4, level]


def rgb_cmd(zone, mode, r, g, b, speed=0xE1, direction=0x01, r2=0, g2=0, b2=0):
    return [0x5A, 0xB3, zone, mode, r, g, b, speed, direction, 0x00, r2, g2, b2]


def main():
    node = find_led_node()
    if not node:
        print("!! no ally:rgb LED node found")
        sys.exit(1)
    hr = find_hidraw(node)
    print(">> LED node:", node)
    print(">> hidraw  :", hr)
    if not hr or not os.path.exists(hr):
        print("!! could not find the hidraw node for the RGB interface")
        sys.exit(1)
    try:
        fd = os.open(hr, os.O_WRONLY)
    except PermissionError:
        print("!! permission denied — run with sudo")
        sys.exit(1)

    def send(data):
        os.write(fd, buf(data))
        time.sleep(0.04)

    try:
        send(RGB_INIT)
        send(config_rgb(0x02))   # enable RGB while awake
        send(brightness(0x03))   # high
        print(">> TEST 1: RAINBOW — watch the rings for ~5s")
        send(rgb_cmd(ZONE_ALL, MODE["rainbow"], 0, 0, 0, speed=0xEB))
        send(RGB_SET)
        send(RGB_APPLY)
        time.sleep(5)
        print(">> TEST 2: SOLID GREEN")
        send(rgb_cmd(ZONE_ALL, MODE["solid"], 0, 255, 0, speed=0x00))
        send(RGB_SET)
        send(RGB_APPLY)
        time.sleep(3)
        print(">> Done. Tell me what the rings did for TEST 1 and TEST 2.")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
