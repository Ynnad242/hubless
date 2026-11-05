#!/bin/sh
# Install Hubless for the current user, or system-wide with --system (run as root).
# The udev rule needs root once: sudo ./install.sh --udev   (the app can also do this itself)
set -e
cd "$(dirname "$0")"
case "$1" in
  --udev)
    install -Dm644 data/70-hubless.rules /etc/udev/rules.d/70-hubless.rules
    udevadm control --reload-rules && udevadm trigger --action=add --subsystem-match=hidraw
    echo "Device access rule installed."; exit 0 ;;
  --system) PREFIX=/usr; LIB=$(python3 -c 'import sysconfig; print(sysconfig.get_path("purelib"))') ;;
  --uninstall)
    rm -rf "$HOME/.local/share/hubless/app" "$HOME/.local/bin/hubless" \
      "$HOME/.local/share/applications/io.github.hubless.Hubless.desktop" \
      "$HOME/.local/share/icons/hicolor/scalable/apps/io.github.hubless.Hubless.svg"
    echo "Hubless removed (backups in ~/.local/share/hubless/backups were kept)."; exit 0 ;;
  *) PREFIX="$HOME/.local"; LIB="$HOME/.local/share/hubless/app" ;;
esac
python3 -c 'import gi; gi.require_version("Gtk","4.0"); gi.require_version("Adw","1"); from gi.repository import Adw' 2>/dev/null || {
  echo "Hubless needs PyGObject, GTK 4 and libadwaita 1.7 or newer:"
  echo "  Arch:          sudo pacman -S python-gobject gtk4 libadwaita"
  echo "  Fedora:        sudo dnf install python3-gobject gtk4 libadwaita"
  echo "  Debian/Ubuntu: sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-adw-1"
  exit 1; }
mkdir -p "$LIB" "$PREFIX/bin"
rm -rf "$LIB/hubless" && cp -r hubless "$LIB/"
find "$LIB/hubless" -name __pycache__ -prune -exec rm -rf {} +
cat > "$PREFIX/bin/hubless" <<EOS
#!/bin/sh
PYTHONPATH="$LIB\${PYTHONPATH:+:\$PYTHONPATH}" exec python3 -m hubless "\$@"
EOS
chmod 755 "$PREFIX/bin/hubless"
install -Dm644 data/io.github.hubless.Hubless.desktop "$PREFIX/share/applications/io.github.hubless.Hubless.desktop"
install -Dm644 hubless/data/icons/io.github.hubless.Hubless.svg "$PREFIX/share/icons/hicolor/scalable/apps/io.github.hubless.Hubless.svg"
install -Dm644 data/io.github.hubless.Hubless.metainfo.xml "$PREFIX/share/metainfo/io.github.hubless.Hubless.metainfo.xml" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$PREFIX/share/icons/hicolor" 2>/dev/null || true
echo "Hubless installed. Start it from your app launcher or run: hubless"
