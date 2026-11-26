using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;

// Original-installation-only updater. It does not create another app, move a
// WebView2 profile, modify any credentials, or install a new shortcut.
internal static class BranchlineWorkspace
{
    private const string OriginalSha256 = "DF991BBEDFFB31D59220CDD859772C09EE4C2ADF6A366597EE8E2786F6AA6E3F";
    private const string PreviousCandidateSha256 = "5F4F99CA151CB89FBA490AC252D9F85E02899481545E3766E600EA6C4DEFDD76";
    private const string UpdatedSha256 = "8CE164CAE547F8BDA5C536C9E16766A95542D3C5D7F135FB6E2D13DFEDCB84E6";
    private const string ExeName = "Branchline Workspace.exe";
    private const string Resource = "Updated.Branchline Workspace.exe";

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try { return Update(); }
        catch (Exception error)
        {
            MessageBox.Show("The existing Branchline Workspace was not updated.\n\n" + error.Message,
                "Branchline Workspace — Round 2 update", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int Update()
    {
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "Branchline Workspace");
        if (!Directory.Exists(root))
            throw new InvalidOperationException("The original Branchline Workspace installation could not be found. No changes were made.");

        var existing = new List<string>();
        foreach (string directory in Directory.GetDirectories(root))
        {
            string candidate = Path.Combine(directory, ExeName);
            if (File.Exists(candidate))
            {
                string checksum = HashFile(candidate);
                if (String.Equals(checksum, OriginalSha256, StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(checksum, PreviousCandidateSha256, StringComparison.OrdinalIgnoreCase))
                    existing.Add(candidate);
            }
        }
        if (existing.Count != 1)
            throw new InvalidOperationException("Exactly one compatible original Branchline Workspace installation was expected, but "
                + existing.Count + " matching executables were found. No changes were made.\n\n"
                + "This updater accepts the owner\'s uploaded November 23 original and the prior navigation update only."
                + " It does not touch any other installation.");

        string target = existing[0];
        if (Process.GetProcessesByName("Branchline Workspace").Any())
        {
            MessageBox.Show("Close Branchline Workspace completely, then run this updater again.\n\n"
                + "Your opened work and editing sessions should be saved before updating.",
                "Close Branchline Workspace first", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 3;
        }

        byte[] payload;
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(Resource))
        {
            if (stream == null) throw new InvalidOperationException("The update payload is missing.");
            using (var buffer = new MemoryStream())
            {
                stream.CopyTo(buffer);
                payload = buffer.ToArray();
            }
        }
        if (!String.Equals(Hash(payload), UpdatedSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The embedded update failed its SHA-256 integrity check.");

        var choice = MessageBox.Show("Update the EXISTING Branchline Workspace installation?\n\n"
            + "This fixes the app icons, complete Branchline branding, universal 1st Megasaver header and four app navigation. It does not uninstall the app, delete projects,"
            + " remove login sessions, or change the Supabase environments.\n\n"
            + "An original-executable backup will be retained in the installation folder.\n\n"
            + target,
            "Branchline Workspace — Navigation Correction Round 2", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (choice != DialogResult.Yes) return 2;

        string stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
        string backup = target + ".backup-" + stamp;
        string pending = target + ".new-" + stamp;
        bool originalMoved = false;
        try
        {
            File.WriteAllBytes(pending, payload);
            if (!String.Equals(HashFile(pending), UpdatedSha256, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The temporary executable failed its SHA-256 integrity check.");

            // Move instead of deleting: it permits a lossless rollback if the
            // final replacement fails. The Start Menu shortcut path is unchanged.
            File.Move(target, backup);
            originalMoved = true;
            File.Move(pending, target);
            if (!String.Equals(HashFile(target), UpdatedSha256, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The new executable failed post-install verification.");

            MessageBox.Show("Branchline Workspace was updated at the original location.\n\n"
                + "Your original executable is preserved as:\n" + backup + "\n\n"
                + "Open Branchline Workspace using your existing desktop shortcut.",
                "Branchline Workspace updated — Round 2", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch
        {
            // Roll back automatically, keeping user data and shortcuts intact.
            if (originalMoved && File.Exists(backup))
            {
                if (File.Exists(target)) File.Delete(target);
                File.Move(backup, target);
            }
            throw;
        }
        finally
        {
            if (File.Exists(pending)) File.Delete(pending);
        }
    }

    private static string HashFile(string file)
    {
        using (var input = File.OpenRead(file))
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
    }

    private static string Hash(byte[] bytes)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "");
    }
}
