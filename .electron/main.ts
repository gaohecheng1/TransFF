import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import isDev from 'electron-is-dev'
import ffmpeg from 'fluent-ffmpeg'

let mainWindow: BrowserWindow | null = null

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 处理视频转码
ipcMain.handle('transcode-video', async (event, {
  inputPath,
  outputPath,
  format,
  resolution
}: {
  inputPath: string
  outputPath: string
  format: string
  resolution?: { width: number; height: number }
}) => {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)

    if (resolution) {
      command = command.size(`${resolution.width}x${resolution.height}`)
    }

    command
      .toFormat(format)
      .on('progress', (progress) => {
        event.sender.send('transcode-progress', progress.percent)
      })
      .on('end', () => resolve(true))
      .on('error', (err) => reject(err.message))
      .save(outputPath)
  })
})