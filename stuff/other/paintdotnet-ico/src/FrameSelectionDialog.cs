using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Travny.PaintDotNetIco;

internal sealed class FrameSelectionDialog : Form
{
    private readonly ListBox frameList = new();

    public FrameSelectionDialog(IReadOnlyList<IcoFrame> frames, int defaultIndex)
    {
        Text = "Open Windows Icon";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(390, 330);

        var label = new Label
        {
            AutoSize = true,
            Text = "Choose an image from this icon:",
            Location = new Point(12, 12)
        };

        frameList.Location = new Point(12, 38);
        frameList.Size = new Size(366, 210);

        foreach (IcoFrame frame in frames)
        {
            string encoding = frame.IsPng ? "PNG" : "bitmap";
            frameList.Items.Add(
                $"{frame.Width} x {frame.Height}   {frame.BitCount}-bit   {encoding}");
        }

        frameList.SelectedIndex = defaultIndex;
        frameList.DoubleClick += (_, _) => OpenSelected();

        var selectedButton = new Button
        {
            Text = "Open selected",
            Location = new Point(12, 268),
            Size = new Size(110, 34)
        };
        selectedButton.Click += (_, _) => OpenSelected();

        var allButton = new Button
        {
            Text = "Open all as layers",
            Location = new Point(130, 268),
            Size = new Size(130, 34)
        };
        allButton.Click += (_, _) =>
        {
            OpenAll = true;
            DialogResult = DialogResult.OK;
            Close();
        };

        var cancelButton = new Button
        {
            Text = "Cancel",
            DialogResult = DialogResult.Cancel,
            Location = new Point(268, 268),
            Size = new Size(110, 34)
        };

        Controls.Add(label);
        Controls.Add(frameList);
        Controls.Add(selectedButton);
        Controls.Add(allButton);
        Controls.Add(cancelButton);
        AcceptButton = selectedButton;
        CancelButton = cancelButton;
    }

    public int SelectedIndex => frameList.SelectedIndex;
    public bool OpenAll { get; private set; }

    private void OpenSelected()
    {
        if (frameList.SelectedIndex < 0) return;
        OpenAll = false;
        DialogResult = DialogResult.OK;
        Close();
    }
}
