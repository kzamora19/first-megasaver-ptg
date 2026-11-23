using Branchline.Workspace;

string[] expectedInShell =
{
    "https://kzamora19.github.io/branchline/apps/",
    "https://kzamora19.github.io/branchline/",
    "https://kzamora19.github.io/first-megasaver-ptg/login/",
    "https://kzamora19.github.io/first-megasaver-ptg/studios/?studio=megaframe",
    "https://kzamora19.github.io/first-megasaver-ptg/studios/?studio=flyer",
    "https://kzamora19.github.io/megaframe-studio/studio/",
    "https://kzamora19.github.io/flyer-studio/studio/"
};
string[] expectedOutside =
{
    "https://kzamora19.github.io/",
    "https://kzamora19.github.io/flyer-studio/",
    "https://kzamora19.github.io/megaframe-studio/",
    "https://kzamora19.github.io/other-repo/",
    "https://kzamora19.github.io.evil.example/branchline/apps/",
    "https://wrong.github.io/branchline/apps/",
    "http://kzamora19.github.io/branchline/apps/",
    "https://user@kzamora19.github.io/branchline/",
    "https://kzamora19.github.io:444/branchline/",
    "javascript:alert(1)",
    ""
};
foreach (var url in expectedInShell)
    if (!WorkspaceNavigationPolicy.IsInternalAppUrl(url))
        throw new Exception("Expected trusted Workspace route: " + url);
foreach (var url in expectedOutside)
    if (WorkspaceNavigationPolicy.IsInternalAppUrl(url))
        throw new Exception("Unexpectedly trusted route: " + url);

Console.WriteLine("PASS: " + expectedInShell.Length +
    " trusted and " + expectedOutside.Length + " rejected Workspace destinations.");
