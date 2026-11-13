# ActiView 录制如何关联到 tauri-eeg 账户

此文是设计建议。当前版本由操作员在实验运行记录中选择 BDF，应用保存文件路径。

## 当天就能使用的流程

研究者登录一次，在实验设置中填写匿名被试编号。ActiView 保存 BDF，应用负责实验事件与前后测。每次采集用不同文件名，结束保存后，在当前账号的实验运行记录中为该次运行选择 BDF。选择文件只建立引用；移动文件后需要重新定位。当前的选择入口及后端检查见 [运行记录](../src/experiment/ExperimentRunHistory.tsx) 和 [文件关联](../src-tauri/src/experiment/records.rs)。

## 建议下一版

1. 每个研究账号首次使用时指定一个采集根目录。若使用共享磁盘，为不同账号分配独立数据集目录。对分析软件可见的是匿名被试编号，数据库内用稳定的账号 ID 归属实验。
2. 在研究者确认准备时，原子预留录制编号、被试、访视、任务、递增的 run 序号和目标相对路径。保存对话框只需粘贴一次完整路径。此时只是预留，取消不产生正式实验；播放开始才创建现有的实验 runId 并绑定预留记录。
3. 例：同一被试、同一次访视的第二次效果评价写入 sub-01/ses-01/eeg/sub-01_ses-01_task-effect_run-02_eeg.bdf。文件名符合 EEG BIDS 的命名方式；完整数据集还需要元数据。现有[文件名生成器](../src/experiment/bdfNaming.ts)默认 session 为 01，缺少 run 序号和 EEG 后缀。[BIDS EEG](https://bids-specification.readthedocs.io/en/stable/modality-specific-files/electroencephalography.html) · [run 定义](https://bids-specification.readthedocs.io/en/stable/appendices/entities.html#run)
4. ActiView 停止保存后，在预留目录检查预期文件，读取 BDF 文件头、时间范围和完整数据记录。修改时间、文件大小稳定只能辅助判断。显示文件名、录制时长，研究者一次确认即可归档。存在冲突、多个候选、分段文件或仍在写入时保留“待核对”，允许手动选取。跨电脑时使用应用可读取的共享目录，或在文件传回后再关联。
5. 在“我的实验”中按被试列出每次运行；同一行可看量表和事件、打开 BDF 所在文件夹、导出报告。文件迁移时先换根目录，用相对路径重定位；无法找到时按大小和归档后计算的 SHA-256 校验手选文件。默认不复制大文件，不改写原始 BDF。

## 归属和时间对齐

BDF 头包含可填写的被试与录制标识、开始日期时间。Status 通道保存触发信号。账户归属由数据库维护：一个账户拥有多次运行，一次运行可关联一个或多个录制文件。文件头和实际记录的事件序列用于核对选中的文件；测试码 254 可重复，不作为文件或账户主键。若导出事件表，应以 BDF 首个保存样本为时间原点，从硬件边沿对齐应用事件，明确缺失标记。[BioSemi BDF](https://www.biosemi.com/faq/file_format.htm) · [BioSemi Trigger](https://www.biosemi.com/faq/trigger_signals.htm) · [BIDS events](https://bids-specification.readthedocs.io/en/stable/modality-agnostic-files/events.html)

## 实施顺序与验收

优先在后端按当前研究账号限定运行详情、BDF 关联、量表历史和导出。现有[历史查询](../src-tauri/src/lib.rs)及[批量导出](../src-tauri/src/effect_reports.rs)存在全库读取，[关联接口](../src-tauri/src/experiment/records.rs)按运行 ID 接受路径。随后实现预留编号、一键复制、结束后关联和找回文件。应用内的账号隔离不能替代共享磁盘上的系统访问权限。

用两个研究账号各建同名被试 sub-01，同一账号重复录两次，验证文件不覆盖、查询互不可见、导出不混合。再覆盖误选别的文件、取消采集、未停止保存、文件移动和分段录制；能回到正确的原始文件及同一次运行的前后测才算通过。
