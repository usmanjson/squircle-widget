const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let isAlwaysOnTop = true;

// Prevent multiple instances running at once
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// Auto-start on Windows login when built into .exe
if (app.isPackaged) {
    app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe')
    });
}

// File path to store last X, Y position
function getStatePath() {
    return path.join(app.getPath('userData'), 'window-state.json');
}

function saveWindowPosition() {
    if (!mainWindow) return;
    try {
        const bounds = mainWindow.getBounds();
        fs.writeFileSync(getStatePath(), JSON.stringify({ x: bounds.x, y: bounds.y }));
    } catch (e) {
        console.error('Failed to save window state:', e);
    }
}

function createWindow() {
    let savedPos = {};
    try {
        if (fs.existsSync(getStatePath())) {
            savedPos = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
        }
    } catch (e) {
        console.error('Could not read window state:', e);
    }

    const windowOptions = {
        width: 336,
        height: 150,            // Always start minimized (150px tall)
        frame: false,
        transparent: true,
        alwaysOnTop: isAlwaysOnTop,
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    };

    // Only set X and Y if valid numbers were saved previously
    if (typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
        windowOptions.x = savedPos.x;
        windowOptions.y = savedPos.y;
    }

    mainWindow = new BrowserWindow(windowOptions);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Save position whenever you drag the widget
    mainWindow.on('moved', saveWindowPosition);

    // Hide to tray instead of quitting when closed
    mainWindow.on('close', (event) => {
        saveWindowPosition();
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        {
            label: mainWindow && mainWindow.isVisible() ? 'Hide Widget' : 'Show Widget',
            click: () => {
                if (!mainWindow) return;
                mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
                updateTrayMenu();
            }
        },
        {
            label: 'Always on Top',
            type: 'checkbox',
            checked: isAlwaysOnTop,
            click: (item) => {
                isAlwaysOnTop = item.checked;
                if (mainWindow) {
                    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
                    mainWindow.webContents.send('pin-state-changed', isAlwaysOnTop);
                }
            }
        },
        {
            label: 'Start at Windows Login',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => {
                app.setLoginItemSettings({
                    openAtLogin: item.checked,
                    path: app.getPath('exe')
                });
            }
        },
        { type: 'separator' },
        {
            label: 'Quit Widget',
            click: () => {
                saveWindowPosition();
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.ico');
    let trayIcon;

    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%23131112"/><circle cx="16" cy="16" r="6" fill="%23baff29"/></svg>`;
        trayIcon = nativeImage.createFromDataURL(fallbackSvg);
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('Squircle Tasks & Notes');
    updateTrayMenu();

    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
        updateTrayMenu();
    });
}

// --- IPC LISTENERS FOR ALL WIDGET BUTTONS ---

// 1. Red Dot: Hide to System Tray
ipcMain.on('window-close-to-tray', () => {
    if (mainWindow) {
        saveWindowPosition();
        mainWindow.hide();
        updateTrayMenu();
    }
});

// 2. Yellow & Green Dots: Resize Window (Temporarily unlocks resizable so Windows never clips it)
ipcMain.on('window-resize', (event, { isExpanded, isMinimized }) => {
    if (!mainWindow) return;
    const targetWidth = isExpanded ? 396 : 336;
    const targetHeight = isMinimized ? 150 : 510;
    const currentBounds = mainWindow.getBounds();

    mainWindow.setResizable(true);
    mainWindow.setBounds({
        x: currentBounds.x,
        y: currentBounds.y,
        width: targetWidth,
        height: targetHeight
    });
    mainWindow.setResizable(false);
});

// 3. Pin Button: Toggle Always-on-Top
ipcMain.on('toggle-always-on-top', (event) => {
    if (!mainWindow) return;
    isAlwaysOnTop = !isAlwaysOnTop;
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    updateTrayMenu();
    event.reply('pin-state-changed', isAlwaysOnTop);
});

app.whenReady().then(() => {
    createWindow();
    createTray();
});