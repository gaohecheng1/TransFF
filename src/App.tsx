import { useState, useEffect } from 'react'
import { Dropzone, FileWithPath } from '@mantine/dropzone'
import { Button, Select, NumberInput, Stack, Text, Progress, Container, Title, Paper, Group, TextInput } from '@mantine/core'
import { AppShell } from '@mantine/core'
import { IpcRenderer } from 'electron'
import path from 'path'
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { IconArrowLeft, IconFolder } from '@tabler/icons-react'

declare global {
  interface Window {
    electron: {
      ipcRenderer: IpcRenderer
    }
  }
}

const ipcRenderer = window.electron.ipcRenderer

interface VideoConfig {
  format: string
  width?: number
  height?: number
  fps?: number
  keepOriginal: boolean
  outputPath: string
}

function MainPage() {
  const navigate = useNavigate()
  const [file, setFile] = useState<FileWithPath | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [isTranscoding, setIsTranscoding] = useState(false)
  const [config, setConfig] = useState<VideoConfig>({
    format: 'mp4',
    keepOriginal: false,
    outputPath: ''
  })

  useEffect(() => {
    ipcRenderer.invoke('get-default-output-path').then((defaultPath) => {
      setConfig(prev => ({ ...prev, outputPath: defaultPath }))
    })
  }, [])

  useEffect(() => {
    if (file) {
      let url;
      if (file instanceof File) {
        url = URL.createObjectURL(file);
      } else if ((file as any).path) {
        // 对于本地文件，使用HTTP服务器提供的URL
        ipcRenderer.invoke('get-video-stream-url', (file as any).path)
          .then(streamUrl => {
            setVideoUrl(streamUrl);
          })
          .catch(error => {
            console.error('获取视频流URL失败:', error);
          });
        return;
      }
      
      if (url) {
        setVideoUrl(url);
        return () => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          setVideoUrl(null);
        };
      }
    }
  }, [file]);

  const handleDrop = async (files: FileWithPath[]) => {
    if (files.length > 0) {
      const droppedFile = files[0];
      
      try {
        // 首先尝试直接获取path属性
        if (droppedFile.path) {
          console.log('通过path属性获取路径:', droppedFile.path);
          const fileInfo = await ipcRenderer.invoke('get-file-info', droppedFile.path);
          const fileWithPath = {
            ...droppedFile,
            path: fileInfo.path,
            name: fileInfo.name,
            type: droppedFile.type || 'video/mp4',
            lastModified: droppedFile.lastModified || Date.now()
          };
          setFile(fileWithPath);
          return;
        }

        // 如果是FileSystemFileHandle，通过handle获取File对象
        if (droppedFile.handle && typeof droppedFile.handle.getFile === 'function') {
          const file = await droppedFile.handle.getFile();
          const filePath = await ipcRenderer.invoke('get-file-path', {
            name: file.name,
            type: file.type,
            lastModified: file.lastModified
          });
          
          if (filePath) {
            console.log('通过FileSystemFileHandle获取路径:', filePath);
            const fileInfo = await ipcRenderer.invoke('get-file-info', filePath);
            const fileWithPath = {
              ...file,
              path: fileInfo.path,
              name: fileInfo.name,
              type: file.type,
              lastModified: file.lastModified
            };
            setFile(fileWithPath);
            return;
          }
        }
        
        // 如果都失败了，尝试通过对话框选择文件
        const result = await ipcRenderer.invoke('show-open-dialog', {
          title: '选择视频文件',
          filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }],
          properties: ['openFile']
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
          const filePath = result.filePaths[0];
          console.log('通过文件对话框获取路径:', filePath);
          const fileInfo = await ipcRenderer.invoke('get-file-info', filePath);
          const fileWithPath = {
            ...droppedFile,
            path: fileInfo.path,
            name: fileInfo.name,
            type: droppedFile.type || 'video/mp4',
            lastModified: droppedFile.lastModified || Date.now()
          };
          setFile(fileWithPath);
          return;
        }
        
        throw new Error('无法获取文件路径');
      } catch (error) {
        console.error('处理文件失败:', error);
        alert('无法获取文件路径，请重新选择文件');
      }
    }
  }

  const handleTranscode = async () => {
    if (!file) return

    const filePath = (file as any).path;
    if (!filePath) {
      alert('无法获取文件路径，请重新选择文件');
      return;
    }

    const fileName = file.name || filePath.split('/').pop();
    const outputPath = `${config.outputPath}/${fileName.replace(/\.[^/.]+$/, `.${config.format}`)}`
    setIsTranscoding(true)
    setProgress(0)

    try {
      ipcRenderer.on('transcode-progress', (_, percent) => {
        setProgress(Math.round(percent))
      })

      navigate('/transcoding', {
        state: {
          inputPath: filePath,
          outputPath,
          format: config.format,
          resolution: config.keepOriginal ? undefined : (config.width && config.height ? {
            width: config.width,
            height: config.height
          } : undefined),
          fps: config.keepOriginal ? undefined : config.fps,
          keepOriginal: config.keepOriginal
        }
      })
      return

      await ipcRenderer.invoke('transcode-video', {
        inputPath: filePath,
        outputPath,
        format: config.format,
        resolution: config.keepOriginal ? undefined : (config.width && config.height ? {
          width: config.width,
          height: config.height
        } : undefined),
        fps: config.keepOriginal ? undefined : config.fps,
        keepOriginal: config.keepOriginal
      })

      alert('转码完成！')
    } catch (error) {
      alert(`转码失败：${error}`)
    } finally {
      setIsTranscoding(false)
      ipcRenderer.removeAllListeners('transcode-progress')
    }
  }

  const handleKeepOriginal = async () => {
    if (file && !config.keepOriginal) {
      const filePath = (file as any).path;
      if (filePath) {
        try {
          const metadata = await ipcRenderer.invoke('get-video-metadata', filePath);
          if (metadata) {
            setConfig(prev => ({
              ...prev,
              keepOriginal: true,
              width: metadata.width,
              height: metadata.height,
              fps: metadata.fps
            }));
            return;
          }
        } catch (error) {
          console.error('获取视频信息失败:', error);
        }
      }
    }
    
    setConfig(prev => ({
      ...prev,
      keepOriginal: !prev.keepOriginal,
      width: undefined,
      height: undefined,
      fps: undefined
    }));
  }

  return (
    <Container size="sm" py="xl" pos="relative">
      <Stack gap="lg">
        <Title order={1} ta="center">TransFF 视频转码工具</Title>

        <Paper p="md" radius="md" withBorder>
          <Dropzone
            onDrop={handleDrop}
            accept={['video/*']}
            maxSize={20 * 1024 ** 3} // 20GB
            multiple={false}
            useFsAccessApi={false}
          >
            <Stack align="center" gap="xs">
              <Text size="xl">拖拽视频文件到这里或点击选择</Text>
              {file && <Text color="dimmed">{file.name}</Text>}
            </Stack>
          </Dropzone>
        </Paper>

        {file && (
          <Paper p="md" radius="md" withBorder>
            <video
              src={videoUrl || ''}
              controls
              style={{ width: '100%', borderRadius: 4 }}
            />
          </Paper>
        )}

        <Paper p="md" radius="md" withBorder>
          <Stack gap="md">
            <TextInput
              label="输出位置"
              value={config.outputPath}
              onChange={(event) => setConfig({ ...config, outputPath: event.currentTarget.value })}
            />

            <Select
              label="输出格式"
              value={config.format}
              onChange={(value) => setConfig({ ...config, format: value || 'mp4' })}
              data={[
                { value: 'mp4', label: 'MP4' },
                { value: 'mov', label: 'MOV' },
                { value: 'avi', label: 'AVI' },
                { value: 'mkv', label: 'MKV' },
                { value: 'webm', label: 'WebM' }
              ]}
            />

            <Group grow>
              <NumberInput
                label="宽度"
                placeholder="可选"
                value={config.width}
                onChange={(value) => setConfig({ ...config, width: typeof value === 'number' ? value : undefined })}
                min={1}
                disabled={config.keepOriginal}
              />
              <NumberInput
                label="高度"
                placeholder="可选"
                value={config.height}
                onChange={(value) => setConfig({ ...config, height: typeof value === 'number' ? value : undefined })}
                min={1}
                disabled={config.keepOriginal}
              />
              <NumberInput
                label="帧率"
                placeholder="可选"
                value={config.fps}
                onChange={(value) => setConfig({ ...config, fps: typeof value === 'number' ? value : undefined })}
                min={1}
                disabled={config.keepOriginal}
              />
            </Group>

            <Group>
              <Button
                variant={config.keepOriginal ? 'filled' : 'light'}
                onClick={handleKeepOriginal}
              >
                保持原视频设置
              </Button>
            </Group>
          </Stack>
        </Paper>

        {isTranscoding && (
          <Progress
            value={progress}
            aria-label={`${progress}%`}
            size="xl"
            radius="xl"
            striped
            animated
          />
        )}

        <Button
          onClick={handleTranscode}
          loading={isTranscoding}
          disabled={!file}
          size="lg"
        >
          开始转码
        </Button>
      </Stack>
    </Container>
  )
}

function TranscodingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [progress, setProgress] = useState(0)
  const [currentFps, setCurrentFps] = useState<number | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null)

  useEffect(() => {
    const startTranscode = async () => {
      if (!location.state) {
        navigate('/')
        return
      }

      try {
        ipcRenderer.on('transcode-progress', (_, data) => {
          setProgress(Math.round(data.percent))
          setCurrentFps(data.currentFps)
          setTimeRemaining(data.timeRemaining)
        })

        await ipcRenderer.invoke('transcode-video', location.state)
        navigate('/success', { state: { outputPath: location.state.outputPath } })
      } catch (error) {
        alert(`转码失败：${error}`)
        navigate('/')
      } finally {
        ipcRenderer.removeAllListeners('transcode-progress')
      }
    }

    startTranscode()
  }, [])

  return (
    <Container size="sm" py="xl">
      <AppShell
        header={{
          height: 60,
          collapsed: false
        }}
      >
        <AppShell.Header h={{ base: 60 }} p="xs">
          <Group>
            <Button
              variant="subtle"
              leftSection={<IconArrowLeft size={20} />}
              onClick={() => navigate('/')}
            >
              返回
            </Button>
          </Group>
        </AppShell.Header>

        <Container py="xl">
          <Stack gap="lg">
            <Title order={2} ta="center">正在转码</Title>
            
            <Paper p="md" radius="md" withBorder>
              <Stack gap="md">
                <Progress
                  value={progress}
                  size="xl"
                  radius="xl"
                  striped
                  animated
                />
                <Text ta="center" size="lg">{progress}%</Text>
                {currentFps && (
                  <Text ta="center">当前帧率: {currentFps} FPS</Text>
                )}
                {timeRemaining && (
                  <Text ta="center">预计剩余时间: {timeRemaining}</Text>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Container>
      </AppShell>
    </Container>
  )
}

function SuccessPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const handleOpenFolder = () => {
    if (location.state?.outputPath) {
      ipcRenderer.invoke('open-folder', location.state.outputPath)
    }
  }

  return (
    <Container size="sm" py="xl">
      <AppShell
        header={{
          height: 60,
          collapsed: false
        }}
      >
        <AppShell.Header h={{ base: 60 }} p="xs">
          <Group>
            <Button
              variant="subtle"
              leftSection={<IconArrowLeft size={20} />}
              onClick={() => navigate('/')}
            >
              返回
            </Button>
          </Group>
        </AppShell.Header>

        <Container py="xl">
          <Stack gap="lg" align="center">
            <Title order={2} ta="center">转码完成！</Title>
            
            <Button
              size="lg"
              leftSection={<IconFolder size={20} />}
              onClick={handleOpenFolder}
            >
              打开文件夹
            </Button>
          </Stack>
        </Container>
      </AppShell>
    </Container>
  )
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/transcoding" element={<TranscodingPage />} />
        <Route path="/success" element={<SuccessPage />} />
      </Routes>
    </Router>
  )
}