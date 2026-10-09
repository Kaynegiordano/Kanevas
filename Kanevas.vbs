' Lance Kanevas sans fenêtre de console.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " """ & a & """"
Next
CreateObject("WScript.Shell").Run """" & dir & "\node_modules\electron\dist\electron.exe"" """ & dir & """" & args, 1, False
