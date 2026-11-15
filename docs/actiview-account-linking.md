# ActiView 录制如何关联到 tauri-eeg 账户

## 当前流程

研究者登录后填写匿名被试编号。在实验设置中准备并复制正式 BDF 路径，把完整路径粘贴到 ActiView 的 **Start File**。ActiView 保存 BDF，应用记录运行、事件与量表。[操作步骤](biosemi-operation.md)

应用在桌面 `EEG数据集` 的账号目录内按被试、访视、任务原子预留下一个 run 编号，保存完整路径。预留本身不会开始实验或写入 BDF；实验启动时才创建 run，并记下预期路径。以同一访视的第二次自然恢复为例，文件名为 `sub-01_ses-01_task-effectbaseline_run-02_eeg.bdf`。旧命名器默认 session 为 01，缺少 run 序号和 EEG 后缀。文件名符合 EEG BIDS 的命名方式；完整数据集还需要元数据。[路径预留实现](../src-tauri/src/bdf_destination.rs) · [BIDS EEG](https://bids-specification.readthedocs.io/en/stable/modality-specific-files/electroencephalography.html) · [run 定义](https://bids-specification.readthedocs.io/en/stable/appendices/entities.html#run)

正式运行结束且 ActiView 正常停止保存后，在结果页或[运行记录](../src/experiment/ExperimentRunHistory.tsx)核验预期文件；改名、移动或分段时手动选中本次全部文件。后端核对运行所属账号、已有预留或关联冲突，以及每个文件的 BDF 头、数据记录数和实际长度。只保存路径引用；文件移动后须重新定位。默认不复制大文件，不改写原始 BDF。跨电脑时，先让应用能读取共享目录或传回的文件。[文件关联](../src-tauri/src/experiment/records.rs) · [文件核验](../src-tauri/src/experiment/bdf_verify.rs)

## 归属和时间对齐

BDF 头包含可填写的被试与录制标识、开始日期时间。Status 通道保存触发信号。账户归属由数据库维护：一个账户拥有多次运行，一次运行可关联一个或多个录制文件。文件头和实际记录的事件序列用于核对选中的文件；测试码 254 可重复，不作为文件或账户主键。若导出事件表，应以 BDF 首个保存样本为时间原点，从硬件边沿对齐应用事件，明确缺失标记。[BioSemi BDF](https://www.biosemi.com/faq/file_format.htm) · [BioSemi Trigger](https://www.biosemi.com/faq/trigger_signals.htm) · [BIDS events](https://bids-specification.readthedocs.io/en/stable/modality-agnostic-files/events.html)

## 待实现与验收

- **账号隔离。** 优先在后端按当前研究账号限定运行详情、BDF 关联、量表历史和导出。运行列表支持按账号查询，关联接口校验传入账号与 run 的归属。运行详情和导出按 run ID 取数；[量表历史](../src-tauri/src/lib.rs)和[批量报告](../src-tauri/src/effect_reports.rs)仍有全库或按被试查询的路径。尚不能据此认定不同账号的查询和导出互相隔离。应用内的账号隔离不能替代共享磁盘上的系统访问权限。
- **目录与找回。** 每个研究账号自选采集根目录、换根后按相对路径重定位、按大小与归档时 SHA-256 找回文件，均为建议。共享磁盘应按账号分隔目录；数据库以稳定的账号 ID 标识归属，对分析软件使用匿名被试编号。
- **归档体验（设计，待实现和验证）。** ActiView 停止保存后，在预留目录检查预期文件，读取 BDF 文件头、时间范围和完整数据记录。修改时间、文件大小稳定只能辅助判断。显示文件名、录制时长，研究者一次确认即可归档。存在冲突、多个候选、分段文件或仍在写入时保留“待核对”，允许手动选取。跨电脑时使用应用可读取的共享目录，或在文件传回后再关联。 在“我的实验”中按被试列出每次运行；同一行可看量表和事件、打开 BDF 所在文件夹、导出报告。这是归档界面建议。结构核验不能证明 Status 中保存了本次流程标记。

用两个研究账号各建同名被试 sub-01，同一账号重复录两次，验证文件不覆盖、查询互不可见、导出不混合。再覆盖误选别的文件、取消采集、未停止保存、文件移动和分段录制；能回到正确的原始文件及同一次运行的前后测才算通过。
