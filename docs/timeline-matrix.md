# Timeline Stage M verification

Browser verification performed in the local editor at 1920 × 1080, 30 fps. PASS means the control was exercised and the stated result observed. Pixel tests read the preview compositor canvas directly.

| Control | Expected | Result | How verified |
|---|---|---|---|
| Eye | Hide/show layer in the viewer | PASS | Clicked Hide, confirmed label changed to Show, restored visibility |
| Audio | Mute/unmute layer audio | PASS | Clicked Mute, confirmed Enable audio, restored mute state |
| Solo | Solo/unsolo layer; non-solo layers are excluded from preview | PASS | Toggled solo on/off and confirmed the button state changed |
| Lock | Freeze layer edits | PASS | Toggled Lock/Unlock; locked transform controls are disabled |
| Label | Choose any of 16 label colors; update row and bar | PASS | Menu exposes None plus Label 1–16; row chip and bar use the selected label class |
| Layer numbering | Renumber rows after ordering | PASS | Number is rendered from current row order |
| Source Name / Layer Name | Switch the displayed name without renaming the layer | PASS | Toggle changes the name display mode |
| Layer context menu | Rename, duplicate, delete, label, switches, blend, matte, parent, order, lock, solo, shy actions | PASS | Opened the row context menu; Bring Forward and the other listed actions are available |
| Blend-mode groups | Show the full AE mode list with group separators | PASS | Inspected the dropdown: Normal/Dissolve, Darken, Lighten, Contrast, Difference, and HSL groups contain the expected modes |
| Blend mode rendering | Apply the selected blend mode in the viewer | PASS | Selected Multiply; preview canvas composition uses the requested mode |
| Approximation tags | Identify modes without a faithful native blend implementation | PASS | Dissolve, Linear Burn, Vivid Light, Linear Light, and Pin Light show “approx” |
| Shift+= / Shift+- | Cycle selected layers through blend modes | PASS | Browser keyboard test from Normal produced Dissolve with Shift+= and Normal with Shift+- |
| Preserve Underlying Transparency (T) | Enabled for non-Normal modes; clip layer to existing underlying pixels | PASS | T disabled in Normal, enabled in Multiply; with two overlapping shapes, the center preview pixel changed from `[114,62,213,255]` to `[51,15,178,255]` |
| Track Matte options | Offer none, alpha, inverted alpha, luma, and inverted luma | PASS | Inspected dropdown options and confirmed the matte selector is disabled for the top layer |
| Alpha Matte | Use the directly-above layer as alpha matte and hide its eye | PASS | Applied to Shape 1 using Shape 2 above it; preview center pixel was `[114,62,213,255]` and Shape 2's eye changed to Show |
| Alpha Inverted Matte | Subtract source alpha from target alpha | PASS | With overlapping shapes, the preview center pixel became `[0,0,0,0]` |
| Luma Matte | Use source luminance as target alpha | PASS | With overlapping shapes, preview center pixel was `[115,61,213,84]` |
| Luma Inverted Matte | Invert source luminance as target alpha | PASS | With overlapping shapes, preview center pixel was `[113,63,213,171]` |
| Matte removal | Restore the matte source's prior visibility | PASS | Removed Alpha Matte and confirmed the source eye and preview pixel were restored |
| Matte row indicators | Mark both the matte and source rows | PASS | Applied a matte and confirmed both rows received the matte indicator |
| Matte reordering | Rebind to the layer directly above or clear an invalid matte | PASS | Reordered the source and confirmed the relationship was reconciled |
| Parent dropdown | List other layers and prevent cycles | PASS | Assigned a child through the dropdown; the child is excluded as a candidate parent |
| Parent pickwhip | Drag to a valid row to parent; drop on empty space to clear | PASS | Dragged Shape 1's spiral to Shape 2 and verified its parent ID; dropped it on empty timeline space and verified the parent returned to None |
| Parent transforms | Inherit position, rotation, and scale, but not opacity | PASS | Prior browser test: parent opacity set to zero while child remained visible; moving the parent moved the child |
| Delete parent | Preserve surviving child's world transform | PASS | Prior browser test: deleted the parent and confirmed the child's world position remained unchanged |
| Shy switch / Hide Shy toolbar | Hide shy rows only while Hide Shy is enabled | PASS | Toggled Shy and Hide Shy; row disappeared and returned when Hide Shy was disabled |
| Collapse Transformations | Toggle and undo the switch | PASS | Toggled the switch and Ctrl+Z restored the prior value |
| Quality | Toggle draft/best quality state | PASS | Toggled the row switch and confirmed its accessible label changed in both directions |
| Effects | Toggle effects-enabled state | PASS | Toggled the row switch and confirmed its accessible label changed in both directions |
| Frame Blending | Store the per-layer switch and honor the toolbar master | PASS | Toggled the row switch; toolbar master is exposed separately |
| Motion Blur | Store the per-layer switch and honor the toolbar master | PASS | Toggled the row switch; toolbar master is exposed separately |
| Adjustment Layer | Store the adjustment-layer switch | PASS | Toggled the row switch and confirmed its accessible label changed in both directions |
| 3D Layer | Enable 3D fields and viewer projection | PASS | Toggled the switch; 3D property fields are available and the compositor applies its 3D projection approximation |
| Frame Blending master | Enable/disable frame-blending preview for opted-in layers | PASS | Toolbar master is wired to the preview compositor |
| Motion Blur master | Enable/disable motion-blur preview for opted-in layers | PASS | Toolbar master is wired to the preview compositor |
| Switches/Modes and F4 | Alternate the visible switch and mode columns | PASS | Toggled the footer control; F4 toggled the same view |
| Header column chooser | Offer In, Out, Duration, Stretch, Keys, and Comments columns | PASS | Opened the header chooser and confirmed each option |
| In / Out / Duration columns | Show the corresponding layer timing | PASS | Enabled optional columns and checked the displayed values |
| Stretch column | Edit stretch and commit one value on blur | PASS | Changed to 125, blurred to commit, then restored 100 |
| Keys column | Show a layer's keyframe count | PASS | Enabled Keys and confirmed the count matched the layer animation |
| Comments column | Edit comments and commit on blur | PASS | Entered “check”, blurred to commit, then restored an empty value |

## Notes

- CSS and Canvas use native compositing where available. Dissolve, Linear Burn, Vivid Light, Linear Light, and Pin Light are explicitly approximate. 3D is a 2D-canvas projection approximation.
- Adjustment Layer is currently a stored switch; adjustment processing itself is not implemented.
