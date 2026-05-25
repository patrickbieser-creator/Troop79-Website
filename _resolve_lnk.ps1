$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut('c:\Users\pat\AppData\Roaming\Microsoft\Windows\Recent\import_20260524-11-42-56.txt.lnk')
Write-Output $lnk.TargetPath
