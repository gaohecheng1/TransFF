import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import isDev from 'electron-is-dev'
import ffmpeg from 'fluent-ffmpeg'
import os from 'os'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'

// 设置FFmpeg和FFprobe路径
ffmpeg.setFfmpegPath(ffmpegPath.path)
ffmpeg.setFfprobePath(ffmpegPath.path)

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../index.html'))
  }

  return win
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

ipcMain.handle('get-file-path', async (_, fileInfo) => {
  try {
    // 在这里可以根据fileInfo中的信息（name, type, lastModified等）
    // 实现自定义的文件路径获取逻辑
    // 目前简单返回一个临时文件路径
    return path.join(app.getPath('temp'), fileInfo.name)
  } catch (error) {
    console.error('获取文件路径失败:', error)
    return null
  }
})

ipcMain.handle('show-open-dialog', (_, options) => {
  return require('electron').dialog.showOpenDialog(options)
})

ipcMain.handle('get-default-output-path', () => {
  if (process.platform === 'darwin') {
    return path.join(app.getPath('downloads'))
  } else if (process.platform === 'win32') {
    return path.join(app.getPath('desktop'))
  }
  return path.join(os.homedir(), 'Downloads')
})

ipcMain.handle('get-video-metadata', async (_, filePath) => {
  return new Promise((resolve, reject) => {
    try {
      console.log('开始获取视频元数据，文件路径:', filePath);
      console.log('FFprobe路径:', ffmpegPath.path);
      
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error('FFprobe错误:', err);
          reject('获取视频信息失败：' + (err.message || '未知错误'));
          return;
        }

        try {
          console.log('FFprobe返回的完整元数据:', JSON.stringify(metadata, null, 2));
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          if (!videoStream) {
            console.error('未找到视频流');
            reject('无法获取视频流信息');
            return;
          }

          console.log('找到视频流:', JSON.stringify(videoStream, null, 2));
          let fps;
          if (videoStream.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split('/');
            fps = parseInt(num) / parseInt(den);
            console.log('从r_frame_rate计算帧率:', num, '/', den, '=', fps);
          } else if (videoStream.avg_frame_rate) {
            const [num, den] = videoStream.avg_frame_rate.split('/');
            fps = parseInt(num) / parseInt(den);
            console.log('从avg_frame_rate计算帧率:', num, '/', den, '=', fps);
          }

          const result = {
            width: videoStream.width,
            height: videoStream.height,
            fps: fps ? Math.round(fps) : undefined
          };

          console.log('最终返回的视频信息:', result);
          resolve(result);
        } catch (parseError: Error | unknown) {
          const errorMessage = parseError instanceof Error ? parseError.message : '未知错误';
          console.error('解析视频信息失败:', parseError);
          reject('解析视频信息失败：' + errorMessage);
        }
      });
    } catch (error) {
      console.error('FFprobe初始化错误:', error);
      reject('FFprobe初始化失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  });
})

ipcMain.handle('transcode-video', async (_, { inputPath, outputPath, format, resolution, fps, keepOriginal }) => {
  return new Promise((resolve, reject) => {
    try {
      if (!inputPath || typeof inputPath !== 'string') {
        throw new Error('输入文件路径无效或为空')
      }

      if (!outputPath || typeof outputPath !== 'string') {
        throw new Error('输出文件路径无效或为空')
      }

      let command = ffmpeg()

      // 添加输入文件
      command.input(inputPath)

      // 设置分辨率
      if (!keepOriginal && resolution) {
        command.size(`${resolution.width}x${resolution.height}`)
      }

      // 设置帧率
      if (!keepOriginal && fps) {
        command.fps(fps)
      }

      // 设置输出格式和其他配置
      command
        .format(format)
        .on('start', (commandLine) => {
          console.log('FFmpeg 开始处理:', commandLine)
        })
        .on('progress', (progress) => {
          const mainWindow = BrowserWindow.getAllWindows()[0]
          if (mainWindow) {
            mainWindow.webContents.send('transcode-progress', progress.percent)
          }
        })
        .on('end', () => {
          console.log('FFmpeg 处理完成')
          resolve(true)
        })
        .on('error', (err) => {
          console.error('FFmpeg 处理错误:', err)
          reject(err.message || '转码过程中发生错误')
        })

      // 设置输出路径并开始处理
      command.save(outputPath)
    } catch (error) {
      console.error('转码初始化错误:', error)
      reject(error instanceof Error ? error.message : '转码初始化失败')
    }
  })
})