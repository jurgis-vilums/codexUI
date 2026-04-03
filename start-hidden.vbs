Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\vilum\Documents\dev\codexui"
shell.Run "node dist-cli\index.js --no-tunnel --no-open --no-password --port 5999 C:\Users\vilum\Documents\dev\codexui", 0, False
