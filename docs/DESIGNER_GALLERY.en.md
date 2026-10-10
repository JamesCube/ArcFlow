# Flow designer gallery

<!-- Legacy fragments remain entry points after the language split. -->
<a id="发布与快照--publish-and-preserve"></a>
<a id="安排步骤--arrange-the-stages"></a>
<a id="流程设计器图集--flow-designer-gallery"></a>
<a id="编辑顺序--edit-the-order"></a>
<a id="配置与校验--configure-and-validate"></a>
<a id="配置之外实际逐人表决--the-rules-in-action"></a>

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](DESIGNER_GALLERY.md) · [Documentation](README.en.md)

Follow one editing journey from ordered stages to publication. These are real application captures with synthetic data, without generated or retouched UI. Click an image for full resolution. The Chinese page provides the same states in Chinese.

This main-workspace designer supports 1–8 ordered stages between fixed start/end nodes, with Bob and Carol in its picker. The domain supports 2–16 fixed participants for host integrations. Arbitrary graphs, BPMN, dynamic departments, delegation, and withdrawal are unsupported. This workspace has no condition editor; see [the capability catalog](CAPABILITIES.en.md) for restricted conditions in three dedicated scenarios.

<!-- topic:arrange-the-stages -->
## Arrange the stages

<a id="sequential"></a>

### 1 · Two named review stages

[![Two named review stages](images/gallery/designer-01-sequential-en.png)](images/gallery/designer-01-sequential-en.png)

Two named sequential stages show who acts first and who follows. The selected stage exposes its reviewer and rejection rule.

<a id="all"></a>

### 2 · Insert an ALL stage

[![Insert an ALL stage](images/gallery/designer-02-insert-all-en.png)](images/gallery/designer-02-insert-all-en.png)

Insert a real stage between existing steps and select Bob + Carol with ALL. Both must approve; any rejection ends the request.

<!-- topic:edit-the-order -->
## Edit the order

<a id="reorder"></a>

### 3 · Change stage order

[![Change stage order](images/gallery/designer-03-reorder-en.png)](images/gallery/designer-03-reorder-en.png)

Move the handover group to the first position. The canvas and selected step number update together.

<a id="undo"></a>

### 4 · Undo the change

[![Undo the change](images/gallery/designer-04-undo-en.png)](images/gallery/designer-04-undo-en.png)

Undo restores the group to the middle; Redo becomes available. Draft history exists only in this browser tab and is cleared on publication or sign-out.

<!-- topic:configure-and-validate -->
## Configure and validate

<a id="any"></a>

### 5 · Switch to ANY

[![Switch to ANY](images/gallery/designer-05-any-en.png)](images/gallery/designer-05-any-en.png)

Switch the same group to ANY. The inspector explains that one approval passes the group and only unanimous rejection ends the request.

<a id="validation"></a>

### 6 · Block invalid publication

[![Block invalid publication](images/gallery/designer-06-validation-en.png)](images/gallery/designer-06-validation-en.png)

Deselecting Carol leaves only one group participant. The inline error and validation summary are visible, and Publish is disabled.

<!-- topic:publish-and-preserve -->
## Publish and preserve

<a id="publish"></a>

### 7 · Publish a new version

[![Publish a new version](images/gallery/designer-07-published-en.png)](images/gallery/designer-07-published-en.png)

Restore valid membership and publish through the UI. The real server returns the new version; the draft becomes up to date and Publish is disabled.

<a id="versions"></a>

### 8 · Preserve an existing request

[![Preserve an existing request](images/gallery/designer-08-saved-version-en.png)](images/gallery/designer-08-saved-version-en.png)

A later ALL template is already published, while this existing leave request still shows the earlier two-stage snapshot. The capture test verifies the saved definition is unchanged.

<a id="votes"></a>

<!-- topic:the-rules-in-action -->
## The rules in action

[![ALL: Bob has approved, Carol is pending](images/gallery/group-all-partial-en.png)](images/gallery/group-all-partial-en.png)

Bob’s vote is saved while Carol remains pending. A handled entry does not mean the whole request is complete.

[![The completed ANY group and saved history](images/gallery/group-any-approved-en.png)](images/gallery/group-any-approved-en.png)

Bob’s approval passes ANY. Carol is not required in that group, then completes a separate final stage. No vote is invented for a non-voting member. [Rules and tests](PARALLEL_APPROVAL.en.md)

[Business journeys](CASE_GALLERY.en.md) · [Image revisions, sources and checksums](images/gallery/provenance.json) · [Reproduce the captures](GALLERY_CAPTURE.en.md)
