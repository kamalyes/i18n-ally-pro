const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// 读取环境变量文件（如果存在）
const envPath = path.join(__dirname, '..', '.env')
let envVars = {}

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split(/\r?\n/).forEach(line => {
    const trimmedLine = line.trim()
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=')
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim()
        envVars[key.trim()] = value
      }
    }
  })
}

// 从环境变量获取内置的 DeepL API 密钥
const builtinApiKey = process.env.BUILTIN_DEEPL_API_KEY || envVars.BUILTIN_DEEPL_API_KEY

if (!builtinApiKey) {
  console.error('❌ 错误：未设置 BUILTIN_DEEPL_API_KEY 环境变量')
  console.log('💡 请设置环境变量：')
  console.log('   1. 在 .env 文件中添加：BUILTIN_DEEPL_API_KEY=your-key-here:fx')
  console.log('   2. 或者在命令行设置：export BUILTIN_DEEPL_API_KEY=your-key-here:fx')
  process.exit(1)
}

console.log('🚀 开始构建 i18n Ally Pro 扩展...')
console.log(`🔑 内置 DeepL API 密钥: ${builtinApiKey.slice(0, 10)}...${builtinApiKey.slice(-3)}`)

// 设置环境变量并运行构建
process.env.BUILTIN_DEEPL_API_KEY = builtinApiKey

try {
  // 运行 webpack 构建
  execSync('webpack --mode production', { 
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  })
  
  console.log('✅ 构建完成！')
} catch (error) {
  console.error('❌ 构建失败:', error.message)
  process.exit(1)
}