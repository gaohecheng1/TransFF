import { useState, useEffect } from 'react'
import { Dropzone, FileWithPath } from '@mantine/dropzone'
import { Button, Select, NumberInput, Stack, Text, Progress, Container, Title, Paper, Group, TextInput } from '@mantine/core'
import { IpcRenderer } from 'electron'
import path from 'path'

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

export default function App() {
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
    if (file instanceof File) {
      const url = URL.createObjectURL(file)
      setVideoUrl(url)
      return () => {
        URL.revokeObjectURL(url)
        setVideoUrl(null)
      }
    }
  }, [file])

  const handleDrop = async (files: FileWithPath[]) => {
    if (files.length > 0) {
      const droppedFile = files[0];
      
      try {
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
            const fileWithPath = {
              ...file,
              path: filePath,
              name: file.name,
              type: file.type,
              lastModified: file.lastModified
            };
            setFile(fileWithPath);
            return;
          }
        }
        
        // 尝试直接获取path属性
        if (droppedFile.path) {
          console.log('通过path属性获取路径:', droppedFile.path);
          const fileWithPath = {
            ...droppedFile,
            path: droppedFile.path
          };
          setFile(fileWithPath);
          return;
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
          const fileWithPath = {
            ...droppedFile,
            path: filePath,
            name: droppedFile.name,
            type: droppedFile.type,
            lastModified: droppedFile.lastModified
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

    const fileName = file.name || path.basename(filePath);
    const outputPath = `${config.outputPath}/${fileName.replace(/\.[^/.]+$/, `.${config.format}`)}`
    setIsTranscoding(true)
    setProgress(0)

    try {
      ipcRenderer.on('transcode-progress', (_, percent) => {
        setProgress(Math.round(percent))
      })

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
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={1} ta="center">TransFF 视频转码工具</Title>

        <Paper p="md" radius="md" withBorder>
          <Dropzone
            onDrop={handleDrop}
            accept={['video/*']}
            maxSize={1024 ** 3} // 1GB
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