; Branchline Workspace Preview — isolated user-level install.
; Staging build only. NEVER overwrite the legacy Branchline Workspace install.
#ifndef AppSource
  #error AppSource is required (publish output)
#endif
#ifndef OutputDir
  #error OutputDir is required (CI artifacts)
#endif

#define AppVersion "0.2.0-preview.1"

[Setup]
AppId={{DD67574D-6DB8-4F31-AD3F-F519C17A2215}
AppName=Branchline Workspace Preview
AppVersion={#AppVersion}
AppVerName=Branchline Workspace Preview {#AppVersion}
AppPublisher=Branchline
DefaultDirName={localappdata}\Programs\Branchline Workspace Preview
DefaultGroupName=Branchline Workspace Preview
UninstallDisplayIcon={app}\Branchline.Workspace.Preview.exe
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=Branchline-Workspace-Preview-Setup-x64
VersionInfoProductName=Branchline Workspace Preview
VersionInfoVersion=0.2.0.1

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Branchline Workspace Preview"; Filename: "{app}\Branchline.Workspace.Preview.exe"

[Run]
Filename: "{app}\Branchline.Workspace.Preview.exe"; Description: "Launch Branchline Workspace Preview"; Flags: nowait postinstall skipifsilent
