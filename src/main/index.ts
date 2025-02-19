import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import isDev from 'electron-is-dev'
import ffmpeg from 'fluent-ffmpeg'
import os from 'os'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import http from 'http'
import fs from 'fs'
import { URL } from 'url'

// 设置FFmpeg和FFprobe路径
ffmpeg.setFfmpegPath(ffmpegPath.path)
ffmpeg.setFfprobePath(ffmpegPath.path)

// 创建HTTP服务器来处理视频文件
let server: http.Server | null = null
let serverPort = 3030

function startVideoServer() {
  server = http.createServer((req, res) => {
    try {
      if (!req.url) {
        throw new Error('请求URL为空');
      }

      console.log('收到视频请求:', req.url);
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      let videoPath = decodeURIComponent(reqUrl.pathname.slice(1));
      console.log('第一次解码后的视频路径:', videoPath);
      
      // 处理macOS临时文件路径
      if (process.platform === 'darwin') {
        // 移除/private前缀
        if (videoPath.startsWith('/private')) {
          videoPath = videoPath.replace('/private', '');
          console.log('处理private前缀后的路径:', videoPath);
        }
        // 确保路径以斜杠开头
        if (!videoPath.startsWith('/')) {
          videoPath = '/' + videoPath;
        }
        console.log('处理路径前缀后的路径:', videoPath);
        
        // 处理可能的多重编码
        let lastPath = videoPath;
        let decodingAttempts = 0;
        const maxDecodingAttempts = 3;

        while (decodingAttempts < maxDecodingAttempts) {
          try {
            const decodedPath = decodeURIComponent(lastPath);
            if (decodedPath === lastPath) {
              break;
            }
            lastPath = decodedPath;
            decodingAttempts++;
            console.log(`第${decodingAttempts}次解码后的路径:`, lastPath);
          } catch (e) {
            console.error(`第${decodingAttempts + 1}次解码失败:`, e);
            break;
          }
        }
        videoPath = lastPath;
      }

      // 规范化路径，移除多余的斜杠
      try {
        videoPath = path.normalize(videoPath);
        console.log('最终规范化后的路径:', videoPath);
      } catch (error) {
        console.error('路径规范化失败:', error);
        throw error;
      }

      // 检查文件是否存在
      try {
        const stats = fs.statSync(videoPath);
        if (!stats.isFile()) {
          console.error('路径存在但不是文件:', videoPath);
          res.writeHead(404);
          res.end('Not a file');
          return;
        }
      } catch (error) {
        console.error('访问文件失败:', error);
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      const stat = fs.statSync(videoPath)
      const fileSize = stat.size
      const range = req.headers.range

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunksize = (end - start) + 1
        const file = fs.createReadStream(videoPath, { start, end })

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4'
        })
        file.pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4'
        })
        fs.createReadStream(videoPath).pipe(res)
      }
    } catch (error) {
      console.error('视频服务器错误:', error)
      res.writeHead(500)
      res.end('Internal server error')
    }
  })

  server.listen(serverPort)
  console.log(`视频服务器启动在端口 ${serverPort}`)
}

// 获取视频流URL
ipcMain.handle('get-video-stream-url', async (_, filePath) => {
  if (!server) {
    startVideoServer()
  }
  return `http://localhost:${serverPort}/${encodeURIComponent(filePath)}`
})

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

ipcMain.handle('open-folder', async (_, filePath) => {
  try {
    const folderPath = path.dirname(filePath)
    await require('electron').shell.openPath(folderPath)
    return true
  } catch (error) {
    console.error('打开文件夹失败:', error)
    return false
  }
})

ipcMain.handle('get-file-info', async (_, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('不是有效的文件');
    }
    return {
      path: filePath,
      name: path.basename(filePath)
    };
  } catch (error) {
    console.error('获取文件信息失败:', error);
    throw error;
  }
});

ipcMain.handle('get-file-path', async (_, fileInfo) => {
  try {
    // 如果传入的是完整路径，直接返回
    if (fileInfo.path) {
      console.log('使用传入的完整路径:', fileInfo.path);
      return fileInfo.path;
    }

    // 否则构建临时文件路径
    const tempPath = path.join(app.getPath('temp'), fileInfo.name);
    console.log('构建的临时文件路径:', tempPath);
    return tempPath;
  } catch (error) {
    console.error('获取文件路径失败:', error);
    return null;
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
        } catch (parseError) {
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

      // 设置编码器配置
      // 设置通用编码器配置
      command
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-c:a', 'aac',
          '-b:a', '128k'
        ])

      // 根据输出格式设置特定配置
      if (format === 'mkv') {
        command.format('matroska')
      } else if (format === 'mp4') {
        command.format('mp4')
      } else if (format === 'webm') {
        command.format('webm')
      } else if (format === 'mov') {
        command.format('mov')
      } else if (format === 'avi') {
        command.format('avi')
      }

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
            // 规范化进度百分比，确保在0-100之间
            // 确保进度值在有效范围内并且是数字
            const rawPercent = typeof progress.percent === 'number' ? progress.percent : 0;
            const normalizedPercent = Math.min(Math.max(rawPercent, 0), 100);
            
            // 改进剩余时间的计算和显示
            let formattedTimeRemaining = '计算中...';
            if (progress.timemark) {
              const timeComponents = progress.timemark.split(':');
              if (timeComponents.length === 3) {
                const [hours, minutes, seconds] = timeComponents.map(t => parseInt(t));
                const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                
                if (totalSeconds > 0) {
                  if (hours > 0) {
                    formattedTimeRemaining = `${hours}小时${minutes}分钟`;
                  } else if (minutes > 0) {
                    formattedTimeRemaining = `${minutes}分钟${seconds}秒`;
                  } else {
                    formattedTimeRemaining = `${seconds}秒`;
                  }
                }
              }
            }

            mainWindow.webContents.send('transcode-progress', {
              percent: normalizedPercent,
              currentFps: progress.currentFps || 0,
              timeRemaining: formattedTimeRemaining
            })
          }
        })
        .on('end', () => {
          console.log('FFmpeg 处理完成')
          resolve(true)
        })
        .on('error', (err) => {
          console.error('FFmpeg 处理错误:', err)
          console.error('FFmpeg 命令行:', err.message)
          reject(`转码失败: ${err.message}`)
        })

      // 设置输出路径并开始处理
      command.save(outputPath)
    } catch (error) {
      console.error('转码初始化错误:', error)
      reject(error instanceof Error ? error.message : '转码初始化失败')
    }
  })
})