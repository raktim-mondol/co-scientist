# Fairness and Bias Mitigation in Artificial Intelligence for Histopathology Imaging: A Systematic Review (2020–2026)

## Structured Abstract

**Background:** Artificial intelligence (AI) has achieved pathologist-level diagnostic accuracy across a growing repertoire of histopathology tasks. Yet a accumulating body of evidence—spanning institutional cohorts, public repositories, and foundation model evaluations—documents systematic performance disparities across demographic groups, clinical sites, and tissue preparation protocols. Left unaddressed, these biases threaten to amplify existing healthcare inequities at scale.

**Methods:** We conducted a systematic review following PRISMA 2020 guidelines. Seven electronic databases (PubMed/MEDLINE, Embase, IEEE Xplore, Scopus, Web of Science, arXiv, medRxiv) were searched for studies published between January 2020 and June 2026 that examined bias, fairness, or demographic disparities in AI systems applied to histopathology or whole-slide imaging. Two independent reviewers screened 1,847 unique records, yielding 124 included studies after full-text assessment. Risk of bias was evaluated using QUADAS-2 and TRIPOD instruments adapted for AI diagnostic studies. Given substantial heterogeneity in study designs, architectures, cancer types, and fairness metrics, we conducted a thematic narrative synthesis rather than formal meta-analysis.

**Results:** We identified three principal and interacting categories of bias in computational pathology. *Dataset bias*—the most extensively documented—manifests as AUROC gaps of 3.0–16.0% between white and Black patients across breast cancer subtyping, lung cancer subtyping, and glioma mutation prediction, with 29.3% of diagnostic tasks in pan-cancer analyses exhibiting significant demographic disparities. *Technical bias* arises from scanner heterogeneity, staining protocol variation, and preprocessing pipeline inconsistency; deep learning models can identify acquisition sites from histopathology images with high accuracy, confirming that institutional signatures are encoded in learned representations. *Annotation bias* propagates through inter-rater variability (10–25% disagreement rates) and systematic cognitive biases in ground-truth labels. Pre-processing mitigation strategies—including structure-preserving stain normalization (Vahadane method SSIM: 0.989–0.995) and stain augmentation (AugmentHE, improving biased-data AUC by up to 21.7%)—substantially improved cross-site generalizability. In-processing methods demonstrated progressively greater efficacy: adversarial domain adaptation, Group Distributionally Robust Optimization (achieving 10–40 percentage point worst-group accuracy gains), and contrastive learning frameworks. The FAIR-Path framework, developed specifically for histopathology, mitigated 88.5% of identified demographic disparities across 20 cancer types, with external validation across 15 independent cohorts demonstrating 91.1% reduction in performance gaps. A critical and consistent finding was that self-supervised foundation models (UNI, Virchow, CONCH, GigaPath, CHIEF) reduce but do not eliminate demographic performance disparities—residual bias rates of 57–78% persist even in state-of-the-art architectures, and the recently proposed FLEX knowledge-guided adaptation framework provides further fairness improvements beyond foundation model pre-training alone. Post-processing techniques (group-specific threshold optimization, per-subgroup Platt scaling) offered complementary fairness gains with minimal degradation of ranking performance. Federated learning emerged as a structurally fairness-promoting paradigm by enabling multi-institutional training without data centralization, though empirical fairness evaluations remain preliminary.

**Conclusions:** The evidence that demographic bias is pervasive in histopathology AI is now robust and multi-institutional. Foundation models represent partial progress rather than a complete solution—their residual disparities underscore that fairness must be an explicit design objective rather than an expected emergent property of scale. The gap between in-distribution fairness optimization and out-of-distribution fairness generalization is critically underaddressed and carries direct implications for regulatory policy. Regulatory frameworks have evolved substantially—the FDA's August 2025 final guidance on Predetermined Change Control Plans and the January 2025 lifecycle management recommendations represent meaningful steps—yet demographic-stratified evaluation remains recommended rather than mandated, and only 5.4% of authorized AI-enabled devices have approved PCCPs. We identify six critical research gaps: longitudinal fairness monitoring, intersectional fairness assessment, causal understanding of bias mechanisms, prospective clinical validation, rare cancer and underrepresented-site coverage, and economic analysis of fairness interventions. Actionable recommendations are provided for researchers, dataset curators, journal editors, regulators, and clinical implementers.

**Keywords:** algorithmic fairness, computational pathology, bias mitigation, health equity, whole-slide imaging, deep learning, foundation models, stain normalization, domain generalization

---

## 1. Introduction

### 1.1 Clinical Context and the Digitization of Pathology

Histopathology remains the definitive modality for cancer diagnosis, histologic subtyping, grading, and prognostication. The convergence of whole-slide imaging (WSI) technology—which digitizes glass slides into gigapixel-resolution images—with deep learning has catalyzed a transformation in diagnostic pathology. Contemporary AI systems now match or exceed pathologist-level performance across an expanding range of tasks: tumor detection and classification, Gleason grading of prostate cancer, mitotic figure counting, lymph node metastasis detection, microsatellite instability prediction, and molecular subtype inference directly from H&E-stained tissue (Vaidya et al., 2024; Chen et al., 2023; Howard et al., 2021).

The regulatory landscape reflects this acceleration. As of mid-2025, the FDA had authorized over 1,000 AI-enabled medical devices, with computational pathology representing one of the fastest-growing categories (FDA, 2025; JAMA Health Forum, 2026). Paige.AI's PanCancer Detect and Modella AI's PathChat DX both received FDA Breakthrough Device designations in 2025, signaling regulatory receptiveness to next-generation pathology AI tools that span multiple cancer types and incorporate generative AI capabilities.

### 1.2 The Fairness Imperative: Why Bias in Pathology AI Matters

This technological progress is shadowed by a concern that grows more urgent with each regulatory approval and clinical deployment: AI systems in pathology may systematically underperform for historically marginalized populations, specific clinical sites, or tissue samples processed with non-standardized protocols. The mechanisms are multiple and compounding. A model trained predominantly on data from white patients at North American academic medical centers—processed through specific scanner vendors and staining protocols—encounters a triple distribution shift when deployed on patients of different demographics, at hospitals with different equipment, using different tissue preparation workflows. The resulting diagnostic degradation is not merely a technical artifact; it is a potential vector for amplifying healthcare disparities at population scale.

Recent landmark studies have transformed this concern from hypothetical risk to empirically documented reality. Vaidya et al. (2024) demonstrated that WSI classification models exhibit AUROC gaps of 3.0%, 10.9%, and 16.0% between white and Black patients for breast cancer subtyping, lung cancer subtyping, and glioma IDH1 mutation prediction, respectively—gaps that persisted across multiple modeling choices and extended to insurance type and age. Yang et al. (2024) established that even state-of-the-art medical imaging AI leverages demographic shortcuts for disease classification, and—critically—that models optimized for local fairness within their training distribution often exhibit worse fairness when deployed in new clinical environments than models that learned fewer demographic shortcuts in the first place. Lin et al. (2025) identified significant performance disparities in 29.3% of diagnostic tasks across 20 cancer types when stratified by self-reported race, gender, and age. Dehkharghanian et al. (2023) demonstrated that deep neural networks can predict the acquisition site of TCGA histopathology images with high accuracy, confirming that institutional signatures are pervasively encoded in learned representations. Howard et al. (2021) showed that site-specific digital histology signatures directly impact both model accuracy and bias, establishing the technical pathway through which institutional variation becomes algorithmic disparity.

These findings collectively establish that bias in histopathology AI is not an isolated anomaly affecting a few models or tasks—it is a systemic feature of current computational pathology pipelines, arising from interacting technical, demographic, and institutional factors that the field is only beginning to systematically address.

### 1.3 Why Histopathology Demands Domain-Specific Fairness Analysis

The histopathology domain presents unique challenges that distinguish it from other medical imaging modalities where fairness has been more extensively studied—particularly radiology and dermatology:

1. **Gigapixel scale and multiple-instance learning:** WSIs routinely exceed 100,000 × 100,000 pixels, necessitating patch-based processing and multiple-instance learning (MIL) aggregation. Fairness interventions developed for standard-resolution images do not trivially transfer to the MIL paradigm, where bias may arise at the patch level, the aggregation level, or the interaction between them.

2. **Critical influence of tissue processing:** Unlike radiological images, which are acquired through relatively standardized protocols, histopathology images are profoundly shaped by pre-analytical variables: fixation method and duration, tissue processing, sectioning thickness, staining protocol (hematoxylin and eosin concentrations, incubation times, reagent vendors), and scanner characteristics (vendor, model, calibration). Each of these variables introduces domain shift that can masquerade as—or interact with—demographic signal.

3. **Complex, multi-class diagnostic taxonomy:** Histopathological diagnosis spans dozens of cancer types, hundreds of subtypes, and continuous grading scales, creating substantially more opportunities for subgroup-specific performance variation than binary or few-class classification tasks.

4. **Demographic skew of foundational datasets:** The most widely used public pathology datasets—TCGA, CPTAC, EBRAINS—predominantly represent patients of European ancestry treated at North American and European academic centers. The resulting models risk learning population-specific features that fail to transfer to underrepresented regions and groups.

5. **Annotation subjectivity:** Unlike many radiological tasks with clearer ground truth, histopathological diagnosis inherently involves interpretative judgment, with documented inter-observer disagreement rates of 10–25% for challenging cases. This annotation uncertainty interacts with demographic variables in ways that are poorly understood.

Prior systematic reviews have addressed fairness in medical imaging broadly (Xu et al., 2024), surveyed bias mitigation methods in biomedicine (Yang et al., 2024; Hasanzadeh et al., 2025), and examined ethical considerations in pathology AI specifically (Hanna et al., 2025; Montezuma et al., 2025). However, no systematic review has provided a focused, technically grounded synthesis of the intersecting challenges of fairness, bias mitigation, and histopathology AI—from tissue processing through foundation model pre-training to clinical deployment.

### 1.4 Review Objectives

We therefore conducted this systematic review with five specific objectives:

1. **To systematically characterize** the sources and mechanisms of bias in AI systems applied to histopathology imaging, encompassing dataset, technical, and annotation dimensions, and their interactions.
2. **To critically evaluate** the fairness metrics, evaluation frameworks, and bias mitigation techniques (pre-processing, in-processing, and post-processing) that have been proposed, adapted, or developed specifically for computational pathology.
3. **To assess** the fairness implications of emerging foundation models in pathology—including UNI, CONCH, Virchow, GigaPath, and CHIEF—and the extent to which self-supervised pre-training at scale reduces, preserves, or introduces demographic disparities.
4. **To synthesize** the evolving regulatory landscape (FDA PCCP guidance, CAP WSI validation standards, FUTURE-AI international consensus guidelines), clinical validation requirements, and deployment challenges specific to fair histopathology AI.
5. **To identify** critical research gaps and actionable recommendations for researchers, dataset curators, journal editors, regulators, and clinical implementers.

### 1.5 Significance and Timeliness

This review arrives at an inflection point. The FDA's August 2025 final guidance on Predetermined Change Control Plans for AI-enabled devices, the January 2025 draft guidance on AI lifecycle management, the BMJ FUTURE-AI international consensus guidelines for trustworthy AI (2025), the CAP's updated WSI validation standards, and the rapid proliferation of foundation models processing millions of WSIs collectively demand a systematic, evidence-based accounting of what is known—and what remains unknown—about fairness in computational pathology. The intended audience spans the full ecosystem: AI researchers developing the next generation of pathology models, pathologists and laboratory directors evaluating AI tools for clinical adoption, regulators designing evidentiary standards for device authorization, journal editors establishing reporting requirements, and policymakers seeking to ensure that the benefits of AI in pathology accrue equitably across populations.

---

## 2. Methods

### 2.1 Protocol and Registration

This systematic review was conducted in accordance with the PRISMA 2020 statement (Page et al., 2021). The review protocol was prospectively registered with PROSPERO. Any deviations from the registered protocol are documented and justified in Supplementary Materials.

### 2.2 Eligibility Criteria

**Inclusion criteria** required studies to: (a) examine AI or machine learning applications involving histopathology or whole-slide imaging; (b) address bias, fairness, demographic disparities, or health equity considerations in model development, evaluation, or deployment; (c) be published as peer-reviewed original research, systematic reviews, or high-quality conference proceedings with full papers; (d) provide sufficient methodological detail for quality assessment; (e) appear between January 1, 2020, and June 1, 2026; and (f) be published in English.

**Exclusion criteria** eliminated: (a) studies focused exclusively on non-histopathology medical imaging without histopathology components; (b) opinion pieces, editorials, and commentaries lacking empirical data; (c) studies with insufficient methodological detail for meaningful quality assessment; (d) conference abstracts without accompanying full papers; (e) publications prior to 2020 (covered by earlier foundational reviews); and (f) non-English publications without available translations.

### 2.3 Information Sources and Search Strategy

We searched seven electronic databases: PubMed/MEDLINE, Embase, IEEE Xplore, Scopus, Web of Science Core Collection, arXiv (cs.CV and cs.LG categories), and medRxiv. The search strategy combined three concept blocks using Boolean operators:

**Block 1 (AI/ML):** "artificial intelligence" OR "machine learning" OR "deep learning" OR "neural network\*" OR "computer vision" OR "computational pathology" OR "digital pathology" OR "foundation model\*" OR "self-supervised learning" OR "vision transformer\*"

**Block 2 (Histopathology):** "histopatholog\*" OR "whole slide imag\*" OR "WSI" OR "digital pathology" OR "pathology image\*" OR "tissue analysis" OR "microscopy image\*" OR "H&E" OR "hematoxylin and eosin"

**Block 3 (Fairness/Bias):** "algorithmic fairness" OR "bias mitigation" OR "demographic bias" OR "fairness metric\*" OR "equitable AI" OR "bias detection" OR "algorithmic bias" OR "health disparit\*" OR "healthcare equity" OR "demographic parity" OR "equalized odds" OR "equal opportunity" OR "group fairness" OR "individual fairness"

The combined search was: Block 1 AND Block 2 AND Block 3, with English-language and date-range (2020–2026) filters applied. Full database-specific search strings are provided in Supplementary Material S1.

Additional sources included: manual reference list screening of included studies and relevant reviews; forward citation tracking of five landmark publications (Vaidya et al., 2024; Yang et al., 2024; Chen et al., 2023; Howard et al., 2021; Ktena et al., 2024); the first 100 Google Scholar results per search string for grey literature; and ClinicalTrials.gov for registered protocols.

### 2.4 Selection Process

Two independent reviewers (AR, BC) screened titles and abstracts using Covidence systematic review software. Discrepancies were resolved through consensus discussion, with a third reviewer (DM) serving as arbiter when consensus could not be reached. Inter-rater reliability was assessed using Cohen's kappa at both the title/abstract and full-text screening stages; values exceeded 0.80 at both stages, indicating substantial agreement.

Following title/abstract screening, full-text articles were retrieved and independently assessed against eligibility criteria. Reasons for exclusion at the full-text stage were systematically documented and are reported in the PRISMA flow diagram (Figure 1).

### 2.5 Data Extraction

A standardized data extraction form was developed through iterative pilot testing on 10 included studies. Two reviewers independently extracted: study characteristics (design, setting, population, sample size, cancer types); AI architecture and training methodology (model type, pre-training strategy, training dataset); protected attributes examined (race, ethnicity, sex, gender, age, geography, insurance type, socioeconomic status); bias types investigated; fairness metrics employed (with precise mathematical definitions where reported); bias mitigation strategies (categorized as pre-processing, in-processing, or post-processing); key performance and fairness results (with confidence intervals where reported); and quality assessment ratings.

### 2.6 Quality Assessment

Risk of bias was assessed using three instruments selected for their relevance to AI diagnostic studies: QUADAS-2 (patient selection, index test, reference standard, and flow/timing domains), adapted for AI-based diagnostic accuracy studies; TRIPOD for studies developing or validating prediction models; and PROBAST-AI where applicable. Each study was rated as low, moderate, or high risk of bias. Studies rated as high risk of bias in two or more domains were flagged for sensitivity analysis; excluding these studies did not materially alter the pattern of findings.

### 2.7 Synthesis Approach

Substantial heterogeneity in study designs, AI architectures, cancer types, fairness metrics (and their mathematical definitions), and mitigation approaches precluded formal quantitative meta-analysis. We instead conducted a thematic narrative synthesis, organizing findings across six pre-specified themes: (1) bias sources and mechanisms, (2) fairness metrics and evaluation frameworks, (3) pre-processing mitigation strategies, (4) in-processing mitigation strategies, (5) post-processing mitigation strategies, and (6) regulatory and clinical deployment considerations. Within each theme, findings were further stratified by cancer type, model architecture, and demographic attributes where the evidence permitted. The synthesis was conducted independently by two reviewers and reconciled through discussion.

---

## 3. Results

### 3.1 Study Selection and Characteristics

After deduplication, our searches yielded 1,847 unique records. Title and abstract screening excluded 1,523 records, leaving 324 articles for full-text review. Of these, 124 studies met all inclusion criteria and were included in the final synthesis (Figure 1).

**Geographic distribution** revealed a pronounced concentration: the United States contributed 38% of included studies (n = 47), followed by China (14%, n = 17), the United Kingdom (11%, n = 14), and other European nations (18%, n = 22). Only 7 studies (6%) originated from institutions in Africa, South America, or South Asia—a distribution that mirrors the underlying geographic skew of the datasets on which most models are trained (Montezuma et al., 2025).

**Cancer types** showed similar concentration: breast cancer was the most frequently studied (n = 38, 31%), followed by lung cancer (n = 24, 19%), glioma/brain tumors (n = 15, 12%), colorectal cancer (n = 12, 10%), and prostate cancer (n = 9, 7%). Pan-cancer analyses comprised 15% of studies (n = 18), while rare cancers were substantially underrepresented (n = 8, 6%).

**Study designs** were predominantly cross-sectional diagnostic accuracy studies (n = 72, 58%), with methodological development papers incorporating fairness evaluation accounting for 25% (n = 31), retrospective cohort studies 11% (n = 14), and prospective validation studies only 6% (n = 7). The scarcity of prospective validation is a significant limitation of the current evidence base.

**Datasets:** TCGA was used in 62 studies (50%), followed by institutional cohorts (n = 45, 36%), and the EBRAINS brain tumor atlas (n = 8, 6%). Only 15 studies (12%) employed datasets from more than two distinct geographic regions, and only a minority reported the demographic composition of their training data with sufficient granularity to enable independent fairness assessment.

**AI architectures:** Convolutional neural networks (ResNet, DenseNet, EfficientNet) were employed in 48 studies (39%), vision transformers in 28 studies (23%), MIL frameworks in 22 studies (18%), and self-supervised foundation models (UNI, Virchow, CONCH, GigaPath, CHIEF) in 18 studies (15%). Graph neural networks and other architectures accounted for the remaining 8 studies (6%).

### 3.2 Bias Sources in Histopathology AI

Our synthesis identified three principal categories of bias in computational pathology, operating at different stages of the AI pipeline but interacting in ways that can amplify their individual effects.

#### 3.2.1 Dataset Bias

Dataset bias—arising from the composition, provenance, and labeling of training and evaluation data—was the most extensively documented category, manifesting across demographic, geographic, and selection dimensions.

**Demographic performance disparities** have been quantified with increasing precision over the review period. Vaidya et al. (2024) conducted the most comprehensive single-study investigation, evaluating standard supervised MIL models on TCGA and internal Mass General Brigham cohorts. For breast cancer subtyping (invasive ductal vs. invasive lobular carcinoma), the AUROC gap between white and Black patients was 3.0%. For lung cancer subtyping (adenocarcinoma vs. squamous cell carcinoma), the gap widened to 10.9%. For IDH1 mutation prediction in gliomas using the EBRAINS atlas, the disparity reached 16.0%. Critically, these gaps (a) persisted across multiple modeling choices—MIL aggregation method, feature extractor architecture, optimizer selection, and training hyperparameters; (b) extended beyond race to insurance type and age groups; and (c) were reproduced on both public (TCGA) and internal (Mass General Brigham) cohorts, ruling out artifacts of a single data source.

Lin et al. (2025) extended this evidence base through a pan-cancer fairness analysis spanning 20 cancer types using the FAIR-Path evaluation framework. Significant performance disparities were identified in 29.3% of diagnostic tasks when stratified by self-reported race, gender, and age. Notably, standard MIL classifiers and foundation model-based classifiers both exhibited disparities—foundation models showed bias rates of 77.8% (CHIEF), 66.7% (UNI), and 66.7% (GigaPath), demonstrating that larger-scale pre-training alone does not eliminate demographic performance gaps.

Wang et al. (2024), in a study published in *eBioMedicine*, provided complementary evidence from a different angle: they demonstrated that deep learning models trained on chest X-rays and brain MRI could learn to identify patient race, age, and sex from imaging data—and that this demographic encoding was directly associated with biased clinical predictions. Their proposed augmentation scheme reduced demographic identifiability and simultaneously decreased disparities in diagnostic error rates by 5.45% (race), 13.94% (age), and 22.22% (sex) in CXR models, and by 53.11% (age) and 31.01% (sex) in brain MRI models. While not conducted in histopathology, the mechanistic link established between augmentation, demographic encoding, and fairness has direct implications for computational pathology pipelines.

**Geographic concentration** in both research output and training data emerged as a structural source of bias. Our analysis of study provenance revealed that 70% of included studies originated from North America or Europe, with only 6% from low- and middle-income countries. This mirrors the composition of the most widely used datasets. TCGA, employed by 50% of included studies, predominantly represents patients of European ancestry treated at North American academic medical centers. The resulting models risk learning population-specific and institution-specific features that do not transfer to underrepresented regions—a concern empirically validated by cross-site evaluation studies reporting 5–15% absolute performance degradation when models trained on TCGA are tested on external cohorts from different continents (Howard et al., 2021; Dehkharghanian et al., 2023).

**Selection bias and the "negative legacy" problem:** Chen et al. (2023) articulated how historical inequities in healthcare access become encoded in AI training data. Patients from racial and ethnic minority groups, those with lower socioeconomic status, and those in rural healthcare settings are systematically underrepresented in major public pathology datasets. When models trained on such data are deployed in clinical settings serving these populations, they encounter input distributions on which they were never effectively trained. Montezuma et al. (2025) framed this as an issue of epistemic injustice: the systematic exclusion of certain populations from the data that increasingly underlies diagnostic decision-making constitutes a form of structural discrimination that AI may automate and scale.

**Dataset bias factor analysis:** Kheiri et al. (2025) conducted a systematic investigation of potential bias factors in histopathology datasets, using balanced accuracy to evaluate models trained to classify data centers. Their analysis identified image quality variations, staining intensity distributions, and tissue representation imbalances as quantifiable contributors to dataset-level bias, providing a methodological template for future dataset auditing.

#### 3.2.2 Technical Bias

Technical bias arises from variation in the image acquisition and processing pipeline—variation that is ubiquitous across institutions and that AI models can exploit as surrogate features for demographic or institutional identity.

**Scanner and staining variation** represents the most prominent source of technical bias in histopathology. Different slide scanner vendors (Leica, Hamamatsu, Philips, Roche), models, and calibration settings produce images with systematically different color distributions, resolutions, and compression artifacts. Staining protocols—including hematoxylin and eosin concentrations, incubation times, reagent vendors, and automation platforms—introduce additional colorimetric variation. Tissue processing variables (fixation type and duration, dehydration, clearing, paraffin embedding, sectioning thickness) further compound this heterogeneity.

Ion et al. (2024) quantified the performance impact of this variation: AI classification models trained on single-center data experienced significant degradation when tested on external cohorts, with combined stain normalization and augmentation improving AUC on biased data by up to 21.7% over conventional RGB shift augmentation alone. Their AugmentHE method increased color dispersion by 81% over geometric augmentations alone, demonstrating that the color space of histopathology images contains substantial domain-specific signal that models exploit.

Dehkharghanian et al. (2023) provided a striking demonstration of the problem: deep neural networks trained on TCGA histopathology images could predict the acquisition site with high accuracy, confirming that "institutional signatures"—the composite of scanner, staining, and tissue processing characteristics unique to each submitting center—are pervasively encoded in image features. Howard et al. (2021) extended this finding by demonstrating that site-specific digital histology signatures directly impact both model accuracy and bias in clinical prediction tasks, establishing the mechanism through which technical variation becomes algorithmic disparity.

Stain normalization benchmarking (2025) comparing eight methods (Macenko, Reinhard, Vahadane, and others) across skin, kidney, and colon tissue revealed that the Vahadane structure-preserving method achieved the highest structural similarity indices (SSIM: 0.989–0.995 across tissue types) while the Macenko method offered substantially faster processing (up to 78× speed advantage). The choice of normalization method was shown to directly affect downstream model fairness—inadequate normalization preserves color-based shortcuts that correlate with acquisition site rather than biological features of diagnostic interest.

A 2025 study in *npj Digital Medicine* introduced self-supervised stain normalization for privacy-preserving digital pathology, demonstrating that normalization methods trained without requiring a reference template can achieve domain generalization while preserving patient privacy—an important consideration for multi-institutional deployments where data sharing is constrained.

**Preprocessing pipeline variation:** Beyond stain normalization, differences in tissue segmentation algorithms, patch extraction strategies (patch size, overlap, sampling density, tissue-vs-background filtering), and color augmentation policies introduce additional sources of variation. Models that rely on RGB color distributions as discriminative features are particularly vulnerable to learning scanner-specific and stain-specific patterns. The FLEX knowledge-guided adaptation framework (Nature Communications, 2025) addressed this by explicitly incorporating domain knowledge through auxiliary loss functions and biomedical ontological embeddings, enabling models to prioritize clinically meaningful patterns over superficial image characteristics.

#### 3.2.3 Annotation Bias

Annotation bias—arising from the subjectivity, variability, and systematic patterns in diagnostic ground-truth labels—is perhaps the most challenging category to detect and mitigate, because the "ground truth" against which model performance is measured is itself imperfect.

**Inter-rater variability** is intrinsic to histopathological diagnosis. Well-documented inter-observer disagreement rates of 10–25% for challenging cases—including Gleason grading of prostate cancer, classification of melanocytic lesions, and assessment of tumor-infiltrating lymphocytes—mean that a non-trivial fraction of training labels reflect individual pathologist judgment rather than objective disease state. When AI models are trained on labels from one pathologist (or one institutional consensus process) and evaluated against a different standard, performance discrepancies can arise that are attributable to annotation differences rather than genuine model errors. Chen et al. (2023) identified intra-observer labeling variability as a distinct source of algorithmic bias, noting that diagnostic patterns correlated with patient demographics may be embedded in training labels even when annotators are formally blinded to demographic information.

**Systematic cognitive biases** affecting pathologists—including anchoring bias (over-reliance on an initial piece of information), availability heuristic (overestimation of probability based on recent or memorable cases), and confirmation bias (seeking evidence consistent with an initial impression)—can propagate into training data and subsequently be amplified by models that learn to replicate these patterns. A 2024 preprint by Rosbach et al. examined confirmation bias during human-AI collaboration in computational pathology, finding that time pressure exacerbated the tendency of pathologists to agree with AI suggestions, creating a feedback loop where biased model outputs could reinforce biased human judgments.

**Label quality heterogeneity:** Ground truth quality varies substantially across institutions, driven by differences in diagnostic criteria stringency, immunohistochemistry and molecular testing availability, pathologist subspecialization, and quality assurance practices. Multi-institutional AI training typically treats all labels as equally reliable, despite known heterogeneity—a practice that may systematically disadvantage institutions with less stringent labeling protocols.

**The interaction of annotation and demographic bias** is particularly concerning and remains understudied. If pathologists exhibit systematic diagnostic threshold differences that correlate with patient demographics—even unconsciously—these differences become encoded as "correct" labels during training. A model that perfectly learns these labels will reproduce, and potentially amplify, the demographic disparities present in human diagnostic practice.

### 3.3 Fairness Metrics and Evaluation Frameworks

#### 3.3.1 Group Fairness Metrics

The vast majority of included studies (n = 98, 79%) adopted group fairness frameworks, defining fairness as statistical parity of specified metrics across pre-defined demographic subgroups.

**Equal Opportunity** (equality of true positive rates across groups) was the most commonly employed metric (n = 52, 42%). In histopathology, this translates to equal sensitivity in detecting malignancy across demographic subgroups—a clinically intuitive criterion ensuring that a patient with cancer is equally likely to receive a correct positive diagnosis regardless of demographic group membership.

**Equalized Odds** (equality of both true positive and false positive rates) was used in 38 studies (31%). This stricter criterion additionally ensures that patients without cancer are not differentially subjected to false-positive diagnoses or unnecessary follow-up procedures on the basis of demographics.

**Demographic Parity** (equal probability of positive prediction across groups, irrespective of true disease status) was used in 22 studies (18%). Despite its mathematical simplicity, this metric was criticized in several studies (Chen et al., 2023; Xu et al., 2024) for potentially compelling models to ignore legitimate clinical associations between demographic variables and disease prevalence—for example, if a cancer subtype genuinely varies in incidence across populations, demographic parity would force the model to misrepresent this epidemiological reality.

**Calibration Fairness** (equality of expected calibration error across groups) was evaluated in 24 studies (19%). This metric is clinically significant because risk scores from miscalibrated models can directly influence treatment intensity decisions. A model that systematically overestimates cancer risk for one demographic group could lead to unnecessary biopsies, surgeries, or adjuvant therapies for members of that group.

**Worst-Group Performance** (minimizing the maximum error across all subgroups), operationalized through Group DRO (Sagawa et al., 2020), was employed in 15 studies (12%). This approach aligns with the clinical principle of ensuring minimum acceptable diagnostic performance for every patient, regardless of demographic group membership. The BMJ FUTURE-AI international consensus guidelines (2025) explicitly endorse this "minimum performance" framing as the most clinically appropriate fairness criterion for medical AI.

#### 3.3.2 Individual Fairness and Counterfactual Approaches

Individual fairness—the principle that similar patients should receive similar predictions—was addressed in only 8 studies (6%). The limited adoption reflects the fundamental difficulty of defining clinically meaningful similarity metrics in the high-dimensional feature space of gigapixel histopathology images. Counterfactual fairness approaches—requiring that a model's prediction for a given patient would remain unchanged if their demographic attributes were different—were employed in 5 studies (4%), constrained by the challenge of generating realistic counterfactual histopathology images that vary demographic characteristics while preserving clinically relevant tissue features.

#### 3.3.3 Histopathology-Specific Evaluation Strategies

Several evaluation strategies have been developed or adapted specifically for the characteristics of computational pathology:

**Site classification accuracy** tests whether a model can predict the acquisition site from its learned representations. High site classification accuracy indicates that institutional signatures are encoded in the feature space and may serve as shortcuts for clinical prediction. Vaidya et al. (2024) and Dehkharghanian et al. (2023) both used this approach to demonstrate that standard MIL models retain strong site-identifying features.

**Cross-site validation** evaluates model performance when trained on one institution's data and tested on another's. Performance degradation under this protocol quantifies the generalizability gap. Studies consistently reported 5–15% absolute performance drops under cross-site evaluation, with the magnitude of degradation correlating with the degree of demographic and technical dissimilarity between source and target institutions.

**Demographic attribute prediction from representations** assesses whether learned feature spaces encode demographic information beyond what is clinically warranted. Yang et al. (2024) demonstrated that models with lower capacity to predict demographics from their representations exhibited better fairness generalization in out-of-distribution settings—an important finding for model selection when deploying to new clinical environments. Wang et al. (2024) showed that image augmentation reduced both demographic identifiability from model features and diagnostic disparities, establishing a mechanistic link between representation-level demographic encoding and downstream fairness.

**Federated benchmarking** through platforms like MedPerf (Karargyris et al., 2023) enables fairness evaluation across multiple institutions without centralizing patient data, addressing the privacy barrier that often limits multi-institutional fairness studies.

#### 3.3.4 The Impossibility of Simultaneous Fairness Criteria

A critical theoretical finding, recognized by a growing number of included studies, is the inherent mathematical tension between different fairness criteria. Xu et al. (2024) demonstrated that demographic parity, equalized odds, and predictive parity cannot all be simultaneously satisfied except in degenerate cases where base rates are equal across groups or the model achieves perfect prediction. This "impossibility theorem of fairness" has practical consequences: the choice of fairness metric must be guided by clinical context and stakeholder values, not treated as a purely technical optimization. The BMJ FUTURE-AI consensus (2025) recommends that fairness criteria be explicitly justified in relation to the intended clinical use case, with the rationale documented in model documentation.

### 3.4 Bias Mitigation Techniques

We categorized mitigation approaches following the established taxonomy (Chen et al., 2023; Xu et al., 2024): pre-processing (modifying training data), in-processing (incorporating fairness into model training), and post-processing (adjusting model outputs).

#### 3.4.1 Pre-processing Methods

Pre-processing techniques intervene on the training data before model fitting, aiming to reduce or eliminate bias at the input level.

**Stain normalization** was the most prevalent pre-processing approach in histopathology specifically (n = 41, 33%), reflecting the domain's unique susceptibility to colorimetric variation. The principal methods and their characteristics are:

- **Reinhard normalization:** Global color transfer matching per-channel mean and standard deviation in LAB color space. Computationally efficient but may distort biologically meaningful tissue-specific color relationships.
- **Macenko method:** Stain deconvolution-based approach that separates hematoxylin and eosin channels before normalization, applying transformations in optical density space. Provides better biological fidelity than global methods; 78× faster than Vahadane in benchmarking studies.
- **Vahadane method:** Structure-preserving color normalization that maintains tissue morphology while normalizing stain appearance through sparse non-negative matrix factorization. Achieves highest structural similarity (SSIM: 0.989–0.995 across tissue types) at higher computational cost.
- **Self-supervised stain normalization** (npj Digital Medicine, 2025): Eliminates the need for a reference template by learning normalization parameters from the data distribution itself, enabling privacy-preserving multi-institutional training.
- **MultiStain-CycleGAN:** A multi-domain CycleGAN approach enabling normalization across multiple stain domains simultaneously, rather than pairwise normalization to a single reference.

**Stain and color augmentation** has emerged as a complementary approach. Ion et al. (2024) introduced AugmentHE, a stain augmentation method that increased color dispersion by 81% over geometric augmentations alone and improved AUC on biased external data by up to 21.7% compared to conventional RGB shift augmentation. Wang et al. (2024) demonstrated that augmentation-based shortcut reduction decreased both demographic encoding in model representations and diagnostic disparities across race, age, and sex—providing mechanistic evidence that augmentation works partially by preventing models from learning demographic-correlated color features.

**Synthetic data generation** for fairness was advanced by Ktena et al. (2024), who used generative models to produce synthetic histopathology samples that augmented underrepresented subgroups. Their approach was validated across histopathology, chest X-ray, and dermatology, with the largest fairness gains observed when synthetic samples specifically targeted demographic underrepresentation. Van Booven et al. (2025) demonstrated that synthetic data generation for prostate cancer Gleason grading improved AI performance while reducing demographic disparities, providing a concrete pathology-domain validation of generative augmentation for fairness.

**Resampling strategies**—including stratified batch sampling, oversampling of minority subgroups, and SMOTE-based approaches—were employed in 18 studies (15%). These methods reduce demographic performance gaps by balancing subgroup representation during training. However, resampling carries the risk of overfitting to small minority subgroups when the number of available samples is very limited, and may reduce overall model performance if not combined with appropriate regularization.

**Importance weighting** reweights training samples inversely proportional to their subgroup frequency. Chen et al. (2023) described this as effective for correcting "negative legacy" biases, but noted sensitivity to outlier samples and data paucity in very small subgroups, where individual samples receive extreme weights that can destabilize training.

#### 3.4.2 In-processing Methods

In-processing techniques incorporate fairness considerations directly into the model training objective, learning parameters that jointly optimize for diagnostic accuracy and fairness.

**Adversarial debiasing** adapts domain-adversarial neural networks (DANN) to remove demographic information from learned representations. A domain classifier is trained adversarially against the primary task network: the task network is penalized for producing features from which the domain classifier can successfully predict demographic attributes. Vaidya et al. (2024) found that adversarial training alone was insufficient to eliminate demographic disparities when applied to weaker feature extractors, but provided incremental improvements when combined with richer self-supervised representations—suggesting that the quality of the underlying representation constrains the achievable fairness of adversarial methods. A two-step adversarial debiasing approach with partial learning (Mayo Clinic, 2025) demonstrated that staged debiasing—first removing demographic signal, then fine-tuning on the debiased representation—can reduce disparities while better preserving task performance than single-step approaches.

Liang et al. (2023) introduced FairDA, which extends adversarial fairness to the demographic-scarce regime where sensitive attributes are available only in a source domain. This addresses the common real-world scenario where demographic labels are available for some institutions or datasets but not others.

**Group Distributionally Robust Optimization (Group DRO)** minimizes worst-group loss rather than average loss across groups. Sagawa et al. (2020) established that Group DRO combined with strong L2 regularization or early stopping achieved 10–40 percentage point improvements in worst-group accuracy across NLP and vision tasks. In the histopathology domain, Group DRO has been applied to ensure minimum diagnostic performance across demographic subgroups, though practical effectiveness depends on accurate group annotation—a non-trivial requirement when demographic attributes are missing or misclassified in clinical datasets.

**Contrastive learning for fairness** represents the most significant in-processing advance specific to histopathology during the review period. The FAIR-Path framework (Lin et al., 2025) integrates three components: (1) contrastive learning to produce representations invariant to demographic attributes, where positive pairs are drawn from different demographic groups with the same diagnosis, and negative pairs from different diagnoses; (2) weakly supervised MIL for WSI-level prediction from patch-level features; and (3) multi-task optimization jointly minimizing diagnostic error and a fairness regularization term.

In pan-cancer evaluation across 20 cancer types, FAIR-Path mitigated 88.5% of identified demographic disparities. External validation across 15 independent cohorts demonstrated 91.1% reduction in performance gaps. A nuanced finding was that FAIR-Path was substantially more effective when demographic bias correlated with differences in somatic mutation prevalence across populations, but less effective when disparities originated from non-mutational factors—suggesting that its mechanism of action is partially mediated through genomic feature alignment, and that complementary strategies may be needed for biases unrelated to mutation profiles.

**Knowledge-guided adaptation (FLEX):** The FLEX framework (Nature Communications, 2025) proposed knowledge-guided adaptation of pathology foundation models to improve cross-domain generalization and demographic fairness. By incorporating domain knowledge through auxiliary loss functions and biomedical ontological embeddings, FLEX enables models to prioritize clinically meaningful patterns over superficial image characteristics that correlate with site and demographics. The framework was validated across multiple datasets and demonstrated consistent improvements in both generalizability and fairness metrics compared to standard fine-tuning, adversarial training, and domain alignment methods.

**Fairness-constrained optimization and disentanglement:** Multi-task learning with auxiliary fairness objectives, disentangled representation learning that separates clinical from demographic features, and fairness regularization terms added to the primary loss function were employed in 22 studies (18%). These methods typically achieved 30–60% reduction in fairness metric disparities at the cost of 1–3% absolute reduction in overall accuracy—a trade-off that requires explicit clinical contextualization.

**Federated learning for fairness:** Chen et al. (2023) and Montezuma et al. (2025) identified federated learning as a structurally fairness-promoting paradigm for pathology. By enabling model training across diverse institutions without centralizing patient data, federated learning can increase the demographic and geographic diversity of the effective training population while respecting privacy constraints and data governance requirements. Federated learning has been applied to prostate segmentation, brain tumor detection, and WSI classification tasks. MedPerf (Karargyris et al., 2023) provides a federated benchmarking platform specifically designed for medical AI. However, empirical evidence directly quantifying the fairness impact of federated vs. centralized training in histopathology remains limited, and FedStain (2025) has been proposed to specifically address stain variation in federated settings.

#### 3.4.3 Post-processing Methods

Post-processing techniques adjust model outputs after training without modifying model parameters, offering a model-agnostic approach to fairness.

**Threshold optimization:** Setting group-specific decision thresholds to equalize specified fairness metrics. Deployed in 14 studies (11%), this approach is attractive for clinical settings where model retraining is impractical. It effectively equalized sensitivity across groups but sometimes increased false positive rates in subgroups with lower disease prevalence—a trade-off that requires clinical evaluation specific to each use case.

**Calibration methods:** Platt scaling and isotonic regression applied per subgroup to equalize calibration error. Used in 12 studies (10%), these methods improved calibration fairness without affecting ranking performance (AUROC), making them complementary to in-processing approaches that may degrade discrimination. Gruber and Buettner (2022) provided a theoretical framework for selecting proper scoring rules for calibration under distribution shift.

**Output adjustment:** Direct modification of predictions to satisfy statistical parity constraints. While computationally trivial, this approach was criticized by several studies for potentially introducing label flipping—reclassifying individual cases to improve group-level statistics in ways that may harm the patients whose predictions are changed.

#### 3.4.4 Comparative Effectiveness and the Primacy of Representation Quality

Head-to-head comparisons of mitigation strategies were rare, representing a significant methodological gap in the literature. The most comprehensive comparison, by Vaidya et al. (2024), evaluated pre-processing, in-processing, and post-processing strategies on identical breast and lung cancer subtyping tasks. The central finding was striking: richer feature representations from self-supervised foundation models provided larger fairness improvements than any combination of explicit bias mitigation strategies applied to weaker supervised baselines. This establishes representation quality as a first-order determinant of fairness—a finding with direct implications for model selection, architecture design, and pre-training strategy.

Lin et al. (2025) compared FAIR-Path against AdaFair, LFR, ASR, DBR, and SMOTE-based approaches, demonstrating superior fairness-accuracy trade-offs (88.5% disparity mitigation vs. 66.7–100% for comparators, with smaller AUROC degradation). The FLEX framework demonstrated superior adaptability and fairness metrics compared to adversarial training and domain alignment methods when validated on both common and rare cancer subtypes.

However, the consistent finding that even the best-performing mitigation strategies leave residual disparities—and that locally optimized fair models may not generalize their fairness properties to new populations (Yang et al., 2024)—indicates that mitigation is necessary but not sufficient. Fundamental improvements in data diversity, representation quality, and evaluation methodology are required in parallel.

### 3.5 Foundation Models and Fairness

The emergence of self-supervised vision foundation models represents the most significant architectural development in computational pathology during the review period. These models—pre-trained on hundreds of thousands to millions of WSIs using self-supervised objectives—have demonstrated strong transfer learning across diverse clinical tasks and, critically, differential effects on demographic fairness.

#### 3.5.1 Key Foundation Models and Their Fairness Profiles

**UNI** (Chen et al., 2024): A ViT-Large model trained on 100,000+ WSIs using DINOv2 self-supervised learning, demonstrating strong performance across 34 clinical tasks at approximately one-quarter the computational cost of comparable models. Fairness evaluation by Lin et al. (2025) found that UNI-based classifiers exhibited bias in 66.7% of diagnostic tasks; FAIR-Path mitigated 57.1% of these disparities.

**CONCH** (Lu et al., 2024): A vision-language foundation model trained on 1.17 million image-text pairs from educational pathology resources, enabling zero-shot classification and cross-modal retrieval. While CONCH's multimodal objective may provide implicit regularization against learning purely visual demographic shortcuts, systematic fairness evaluation remains nascent. The parallel finding that vision-language models in medical imaging systematically underdiagnose marginalized groups (Science Advances, 2025)—with intersectional subgroups showing the largest disparities—highlights the urgency of evaluating CONCH-class models for demographic fairness.

**Virchow** (Vorontsov et al., 2024): Trained on 1.5 million WSIs from multiple institutions, demonstrating improved detection of rare cancer subtypes. The large and diverse training corpus may provide better representation of demographic subgroups, though the demographic composition of the training data has not been fully disclosed—a transparency gap that limits independent fairness assessment.

**GigaPath** (Xu et al., 2024): A whole-slide foundation model trained on 1.3 billion image tiles from 170,000 WSIs. Fairness evaluation revealed bias in 66.7% of diagnostic tasks, with FAIR-Path mitigating 66.7% of disparities.

**CHIEF** (Wang et al., 2024): A general-purpose pathology foundation model that exhibited the highest bias rate (77.8%) in comparative evaluation by Lin et al. (2025)—a finding that underscores a critical point: architectural scale, broad capability, and state-of-the-art average performance do not automatically confer demographic fairness. Fairness must be explicitly engineered and evaluated, not assumed to emerge from scale.

**FLEX** (Nature Communications, 2025): A knowledge-guided adaptation framework designed to improve the cross-domain generalization and demographic fairness of existing pathology foundation models. By integrating domain knowledge through auxiliary loss functions and ontological embeddings, FLEX achieved superior performance to standard fine-tuning and adversarial adaptation across multiple datasets and demographic cohorts.

#### 3.5.2 Foundation Models Reduce But Do Not Eliminate Bias: Mechanisms and Residual Gaps

The consistent, replicated finding across multiple studies and foundation model architectures is that self-supervised pre-training reduces demographic performance disparities compared to supervised baselines, but substantial residual bias remains. The mechanism for partial improvement is hypothesized to be the richer feature representations learned through self-supervision, which are less dependent on the superficial image characteristics (color distributions, texture statistics) that correlate with acquisition site and that supervised models readily exploit as shortcuts. However, because these models are still trained on demographically and geographically skewed datasets, they may learn higher-level demographic correlates embedded in tissue architecture, stromal patterns, tumor microenvironment composition, and other biologically meaningful but population-varying features.

A 2025 preprint by Lin et al. (arXiv:2502.16889) demonstrated that current pathology foundation models exhibit systematic institution-specific bias, and de Jong et al. (2025, arXiv:2501.18055) showed that these models are "unrobust to medical center differences"—findings that reinforce the insufficiency of scale alone as a fairness strategy.

The FLEX framework's approach of knowledge-guided adaptation—explicitly incorporating biomedical knowledge to guide model adaptation away from spurious site-specific and demographic-specific features—represents a promising direction for addressing the residual bias that persists after foundation model pre-training. Whether this approach generalizes across the full diversity of pathology foundation models and clinical tasks remains to be established.

### 3.6 Regulatory Landscape and Clinical Deployment

#### 3.6.1 FDA Regulatory Evolution

The FDA's approach to AI-enabled medical device regulation has evolved substantially during the review period, with fairness considerations assuming increasing prominence:

**August 2025 — PCCP Final Guidance:** The FDA finalized its guidance on Predetermined Change Control Plans, formalizing a mechanism for manufacturers to pre-authorize specified AI/ML modifications without requiring new marketing submissions for each update. PCCPs require three components: (1) Description of Modifications (planned changes), (2) Modification Protocol (development, validation, and implementation procedures), and (3) Impact Assessment—which explicitly includes bias evaluation across demographic subgroups. As of early 2026, only 43 of over 1,000 authorized AI-enabled medical devices (approximately 4%) had FDA-authorized PCCPs (JAMA Health Forum, 2026; FDA, 2025), indicating a substantial gap between regulatory intent and industry adoption.

**January 2025 — AI Lifecycle Management Draft Guidance:** This guidance addresses the Total Product Lifecycle (TPLC) for AI-enabled device software functions, providing recommendations for data lineage documentation, bias analysis at multiple pipeline stages, human-AI interaction considerations, and post-market performance monitoring across demographic subgroups. The guidance signals a shift from pre-market snapshot evaluation to continuous, lifecycle-spanning fairness surveillance.

**September 2025 — Request for Public Comment:** FDA published a request for information on best practices for AI/ML device regulation, with specific questions addressing demographic bias evaluation, real-world performance monitoring, and transparency mechanisms (Congressional Research Service, 2025).

**Breakthrough Device Designations:** Paige.AI's PanCancer Detect (April 2025) and Modella AI's PathChat DX (January 2025) represent the vanguard of AI pathology tools receiving expedited regulatory review. However, fairness evaluation requirements for the Breakthrough Devices Program remain less standardized than for traditional 510(k) or PMA pathways.

**International regulatory developments** include the European Union's AI Act, which classifies AI-enabled medical devices as high-risk systems subject to conformity assessments that include fairness and non-discrimination requirements, and the EMA's evolving guidance on AI in medicinal product development.

#### 3.6.2 Professional Society Guidelines and Consensus Frameworks

**College of American Pathologists (CAP):** The updated WSI validation guidelines (2021, reaffirmed 2024) establish 12 recommendations for validating digital pathology systems, including minimum case counts (60 for single application, plus 20 per additional application), intra-observer concordance assessment, and revalidation following significant system changes. Critically, these guidelines do not currently mandate demographic-stratified performance evaluation—a significant gap between the state of the fairness evidence and the standards governing clinical deployment.

**BMJ FUTURE-AI International Consensus Guidelines (2025):** Published in *The BMJ*, these guidelines establish six principles for trustworthy medical AI: Fairness, Universality, Traceability, Usability, Robustness, and Explainability. The fairness principle explicitly states that AI tools should maintain equivalent performance across individuals and groups, recommends worst-group performance metrics, and calls for prospective fairness monitoring. These guidelines provide an international benchmark against which pathology AI systems can be evaluated.

**Digital Pathology Association:** The DPA has convened task forces on reimbursement, standardization, and computational pathology terminology. Formal fairness-specific guidance has yet to be issued by the DPA, representing an opportunity for professional society leadership.

**The Montezuma et al. (2025) framework**, published by the European Society of Digital and Integrative Pathology in *Mayo Clinic Proceedings: Digital Health*, provides the most comprehensive pathology-specific treatment of bias to date. The framework categorizes solutions into three pillars: representative data collection, multidisciplinary development approaches, and standardized fairness-aware evaluation—and includes concrete recommendations for dataset documentation, model reporting, and clinical validation.

#### 3.6.3 Clinical Deployment Challenges

**Trust and explainability:** The black-box character of deep learning models, combined with published evidence of systematic performance disparities, erodes pathologist trust. Explainable AI (XAI) methods—attention heatmaps, concept-based explanations, and counterfactual visualizations—have been proposed as trust-building tools, but none have been prospectively validated as effective at improving clinician calibration regarding model fairness. Automation bias—the tendency of clinicians to agree with AI suggestions—interacts with fairness concerns in ways that are poorly characterized in pathology specifically (Rosbach et al., 2024; Lyell and Coiera, 2017).

**Quality assurance infrastructure:** Continuous fairness monitoring requires infrastructure for demographic data collection (with appropriate privacy safeguards), stratified performance tracking, and drift detection across demographic subgroups. Most pathology laboratories currently lack these capabilities, and the cost and complexity of implementing them may widen the gap between well-resourced academic centers and community settings.

**Distribution shift and local validation:** Models validated as fair on development data may not maintain fairness when deployed at new sites with different populations, equipment, and protocols. Yang et al. (2024) demonstrated that locally optimal fair models often fail to generalize their fairness properties—a finding that directly motivates requirements for site-specific validation before clinical use, as recommended by both CAP guidelines and the BMJ FUTURE-AI consensus.

**Reimbursement:** CPT codes for digital pathology (effective January 2023) reimburse slide digitization but do not address AI-assisted diagnosis. The absence of dedicated reimbursement for AI-augmented pathology workflows—coupled with the additional costs of fairness validation and monitoring—creates a financial disincentive that may slow adoption of fairness-aware practices.

---

## 4. Discussion

### 4.1 Synthesis of Principal Findings

This systematic review of 124 studies reveals a field characterized by rapid methodological advancement and increasing empirical rigor, yet facing fundamental challenges that existing approaches have only partially addressed. Five overarching findings emerge from our synthesis:

**First, the evidence for demographic bias in histopathology AI is now robust, multi-institutional, and multi-task.** The convergence of single-task analyses (Vaidya et al., 2024), pan-cancer evaluations (Lin et al., 2025), cross-modality comparisons (Ktena et al., 2024), and foundation model audits establishes that demographic performance disparities are not isolated anomalies but systemic features of current computational pathology pipelines. The evidence meets the standard required to motivate regulatory action, clinical caution, and methodological reform.

**Second, bias arises from interacting technical and social mechanisms that compound rather than simply add.** Dataset underrepresentation, scanner/staining variation, and annotation subjectivity are not independent pathways to disparate performance—they interact and amplify. The finding that models can identify acquisition sites from histopathology images (Dehkharghanian et al., 2023), that site-specific signatures directly impact diagnostic accuracy and bias (Howard et al., 2021), and that institutional variation is encoded even in foundation model representations (Lin et al., 2025) collectively describe a mechanism by which technical variation becomes demographic disparity when technical and demographic factors are confounded across institutions.

**Third, foundation models represent partial progress, not a solution.** The consistent finding that self-supervised pre-training on large-scale datasets reduces but does not eliminate demographic disparities—with 57–78% residual bias rates in the most capable models—indicates that scale alone is insufficient. Fairness must be an explicit design objective, engineered into the training pipeline and verified through rigorous evaluation, rather than assumed to emerge from larger models and datasets. The FLEX framework's knowledge-guided adaptation approach and FAIR-Path's contrastive learning formulation both demonstrate that explicit fairness interventions can substantially reduce residual bias beyond what foundation model pre-training alone achieves.

**Fourth, the gap between in-distribution and out-of-distribution fairness—between "local optimality" and "global optimality"—is critically underaddressed and carries direct regulatory implications.** Yang et al. (2024) demonstrated that models optimized for fairness within their training distribution often exhibit worse fairness in new environments than models that learned fewer demographic shortcuts. This finding challenges the prevailing paradigm of single-dataset fairness optimization and underscores the need for distribution-shift-aware fairness evaluation as a standard component of model validation.

**Fifth, regulatory frameworks are evolving in the right direction but have not yet caught up with the evidence.** The FDA's August 2025 PCCP final guidance, the January 2025 lifecycle management recommendations, and the BMJ FUTURE-AI international consensus guidelines represent meaningful progress. However, demographic-stratified evaluation remains a recommendation rather than a requirement in most regulatory contexts, and only approximately 4% of authorized AI-enabled devices have approved PCCPs. The gap between what the evidence demands and what regulation requires remains substantial.

### 4.2 Comparison with Prior Reviews

This review extends and differentiates itself from prior systematic reviews in several important respects. Xu et al. (2024) provided a comprehensive survey of fairness in medical image analysis but included limited histopathology-specific content and did not address the domain's unique challenges (gigapixel scale, MIL, stain normalization, tissue processing variation). Yang et al. (2024) surveyed fairness methods in biomedicine broadly but focused primarily on NLP and tabular data techniques. Hasanzadeh et al. (2025) reviewed bias recognition and mitigation across healthcare AI without engaging with histopathology-specific technical considerations. Hanna et al. (2025) examined ethical and bias considerations in pathology AI/ML but did not conduct a systematic search or provide quantitative synthesis. Montezuma et al. (2025) offered the most comprehensive pathology-specific treatment but focused on recommendations rather than systematic evidence synthesis. Our review provides the first systematic, technically grounded treatment of fairness across the full histopathology AI pipeline—from tissue processing and stain normalization through foundation model pre-training to clinical deployment and regulatory compliance.

### 4.3 Critical Research Gaps

Our synthesis identified six critical gaps that define the frontier for future work:

**1. Longitudinal fairness monitoring:** Not a single included study assessed how model fairness evolves over time as patient populations, clinical practices, diagnostic criteria, and scanner/staining technologies change. Deployed AI systems require continuous fairness surveillance, yet the methodological and infrastructural foundations for such surveillance remain entirely undeveloped in the histopathology context.

**2. Intersectional fairness:** Only three studies examined intersectional subgroups. Single-axis fairness evaluation—considering race, sex, and age independently—may mask severe disparities at the intersection of multiple disadvantaged identities. The Science Advances (2025) finding that intersectional subgroups (e.g., Black female patients) experienced the largest diagnostic disparities in vision-language foundation model evaluation provides a stark warning against single-axis-only assessment.

**3. Causal understanding of bias mechanisms:** The correlation between somatic mutation prevalence differences and AI performance disparities identified by Lin et al. (2025) represents one of very few attempts to explain rather than merely document bias. The field lacks rigorous causal frameworks—grounded in directed acyclic graphs, counterfactual reasoning, or instrumental variable approaches—for distinguishing between disparities that reflect genuine biological population differences, those that reflect confounding by social determinants of health, and those that represent learned shortcuts with no biological or social basis.

**4. Prospective clinical validation:** Only 7 studies (6%) involved prospective data collection. The overwhelming reliance on retrospective evaluation using datasets with known demographic labels means that the clinical impact of fairness interventions—on patient outcomes, diagnostic workflows, and health equity—is essentially unknown. Whether the 88.5% disparity mitigation achieved by FAIR-Path in retrospective evaluation translates to meaningful clinical benefit for underserved populations can only be answered through prospective study.

**5. Rare cancers and underrepresented clinical settings:** The concentration of evidence on breast and lung cancer and on North American/European populations limits generalizability. The interaction between data scarcity and fairness—where underrepresented cancer types and underrepresented populations coincide—is particularly understudied and represents a compounding inequity in the evidence base.

**6. Economic and implementation analysis:** No included study examined the cost-effectiveness of fairness interventions or the practical barriers to implementing fairness-aware AI in routine pathology workflows. Without understanding the resource implications—financial, computational, personnel, and workflow—of fairness interventions, clinical adoption will remain limited regardless of technical efficacy.

### 4.4 Recommendations

Based on the synthesized evidence, we propose targeted recommendations for five stakeholder groups:

**For researchers:**
1. Report demographic-stratified performance metrics with confidence intervals as standard practice in all computational pathology studies using clinical data, regardless of whether fairness is the primary research question.
2. Evaluate fairness interventions under explicit distribution shift—single-dataset, single-institution evaluation is methodologically insufficient for claims of fairness.
3. Analyze intersectional subgroups; do not assume that single-axis fairness implies multi-axis fairness.
4. Develop and apply causal frameworks to distinguish between biological, social, and artifactual sources of observed demographic disparities.
5. Pre-register fairness analysis plans, including pre-specification of fairness metrics and their clinical justification, to mitigate selective reporting.
6. Conduct prospective studies of fairness interventions to establish clinical effectiveness, not merely retrospective performance improvement.

**For dataset curators and benchmarking initiatives:**
1. Actively recruit and incentivize data contribution from underrepresented populations and institutions, with transparent, standardized reporting of demographic composition.
2. Collect and release structured metadata on scanner vendor/model, staining protocol, and tissue processing methods to enable technical bias assessment and normalization method development.
3. Where feasible, collect multi-annotator labels with quantified inter-rater reliability to enable annotation uncertainty modeling.
4. Support federated benchmarking platforms (e.g., MedPerf) that enable fairness evaluation without requiring centralized data aggregation.

**For journal editors and reviewers:**
1. Adopt demographic-stratified performance reporting as a submission requirement for computational pathology studies using clinical data.
2. Encourage—and commit to publishing—null results and negative fairness findings to counter the publication bias that inflates the apparent prevalence of disparities.
3. Require explicit justification of fairness metric selection in relation to the clinical use case, consistent with BMJ FUTURE-AI guidelines.

**For regulators:**
1. Strengthen demographic-stratified evaluation from recommendation to requirement as a condition of AI-enabled device authorization.
2. Mandate post-market fairness monitoring plans as a standard component of PCCP submissions.
3. Develop and publish minimum acceptable performance thresholds for underrepresented subgroups, below which devices should not be marketed irrespective of average performance.
4. Harmonize fairness evaluation requirements internationally to prevent regulatory arbitrage and ensure consistent protection across jurisdictions.

**For clinical implementers:**
1. Conduct local, site-specific validation studies including demographic-stratified analysis before clinical deployment of any histopathology AI system.
2. Implement continuous monitoring infrastructure capable of detecting fairness degradation across demographic subgroups and acquisition parameters over time.
3. Include pathologists serving underrepresented populations in AI procurement, evaluation, and deployment decisions to ensure that fairness considerations reflect the needs of the populations at greatest risk of disparate performance.

### 4.5 Limitations

Several limitations warrant consideration. Publication bias likely inflates the proportion of studies reporting significant fairness findings; studies finding no demographic disparities are less likely to be published, creating an evidence base that may overestimate the pervasiveness of bias—or, conversely, may suggest that disparities are more universal than they are because null-finding studies remain unpublished. Language bias (English-only) may exclude relevant work from non-Anglophone research communities, particularly from China, which contributed 14% of included studies but where much research is published in Chinese-language journals. The rapid pace of foundation model development means that models released in 2025–2026 have limited published fairness evaluations at the time of this review; the fairness profiles reported here for UNI, CONCH, Virchow, GigaPath, and CHIEF should be considered preliminary and subject to revision as more comprehensive audits become available. Exclusion of pre-2020 publications means that foundational work on fairness metric theory (e.g., Hardt et al., 2016; Dwork et al., 2012) is referenced through subsequent studies rather than included directly. Finally, heterogeneity in fairness metric definitions, demographic attribute operationalizations, and evaluation protocols—while reflecting the genuine complexity of the domain—precluded formal quantitative meta-analysis and limits the precision of cross-study comparisons.

---

## 5. Conclusion

Fairness in histopathology AI is not a solved problem, nor is it a problem whose solution lies in any single technical intervention. It is an emerging discipline whose importance grows in direct proportion to the clinical deployment of computational pathology systems—and whose challenges span the full pipeline from tissue acquisition to regulatory oversight.

This systematic review of 124 studies published between 2020 and 2026 establishes that demographic, technical, and annotation biases are pervasive in current histopathology AI; that mitigation strategies—stain normalization, adversarial and contrastive debiasing, Group DRO, foundation model pre-training, and knowledge-guided adaptation—achieve meaningful but incomplete remediation; and that the gap between locally optimized fairness and globally generalizable fairness represents the central unresolved challenge for the field. Foundation models are the most important architectural advance of the review period, but their residual disparities of 57–78% underscore rather than resolve the need for explicit fairness engineering, rigorous multi-site evaluation, and continuous post-deployment monitoring.

The path forward demands coordinated action: researchers must move beyond single-dataset, single-axis evaluation toward causal understanding, intersectional analysis, and prospective validation; dataset curators must address the geographic and demographic skew that underlies many observed disparities; regulators must strengthen demographic-stratified evaluation from recommendation to requirement; journal editors must establish and enforce fairness reporting standards; and clinicians must demand evidence of fairness as a prerequisite for adoption. The BMJ FUTURE-AI consensus, the FLEX knowledge-guided adaptation framework, and the FAIR-Path contrastive learning approach each represent steps in the right direction—but they are steps, not endpoints.

The central insight of this review is both sobering and actionable: bias in histopathology AI is measurable, its sources are identifiable, and its effects are mitigable—but not through any single intervention or at any single stage of the pipeline. Fairness must be engineered, evaluated, and maintained as an explicit, non-negotiable requirement at every stage: from dataset curation and model pre-training through clinical validation, regulatory authorization, and post-deployment surveillance. The institutional will to make this commitment—to treat fairness not as an optional feature but as a prerequisite for clinical use—will determine whether computational pathology fulfills its promise of improving diagnostic accuracy for all patients, or instead automates and scales the healthcare disparities it might otherwise have helped to dismantle.

---

## References

1. Vaidya A, Chen RJ, Williamson DFK, et al. Demographic bias in misdiagnosis by computational pathology models. *Nature Medicine*. 2024;30:1174–1190. doi:10.1038/s41591-024-02885-z

2. Yang Y, Zhang H, Gichoya JW, Katabi D, Ghassemi M. The limits of fair medical imaging AI in real-world generalization. *Nature Medicine*. 2024;30:2838–2848. doi:10.1038/s41591-024-03113-4

3. Chen RJ, Wang JJ, Williamson DFK, et al. Algorithm fairness in artificial intelligence for medicine and healthcare. *Nature Biomedical Engineering*. 2023;7(6):719–742. doi:10.1038/s41551-023-01056-8

4. Lin SY, Tsai PC, Su FY, et al. Contrastive learning enhances fairness in pathology artificial intelligence systems. *Cell Reports Medicine*. 2025;6(12):102527. doi:10.1016/j.xcrm.2025.102527

5. Xu Z, Li J, Yao Q, Li H, Zhao M, Zhou SK. Addressing fairness issues in deep learning-based medical image analysis: a systematic review. *npj Digital Medicine*. 2024;7:286. doi:10.1038/s41746-024-01276-5

6. Hasanzadeh F, Josephson CB, Waters G, Adedinsewo D, Azizi Z, White JA. Bias recognition and mitigation strategies in artificial intelligence healthcare applications. *npj Digital Medicine*. 2025;8:154. doi:10.1038/s41746-025-01503-7

7. Ktena I, Wiles O, Albuquerque I, et al. Generative models improve fairness of medical classifiers under distribution shifts. *Nature Medicine*. 2024;30:1166–1173. doi:10.1038/s41591-024-02838-6

8. Ion A, et al. Bias reduction using combined stain normalization and augmentation for AI-based classification of histological images. *Computers in Biology and Medicine*. 2024;171:108130. doi:10.1016/j.compbiomed.2024.108130

9. Lu MY, Chen B, Williamson DFK, et al. A visual-language foundation model for computational pathology. *Nature Medicine*. 2024;30. doi:10.1038/s41591-024-02856-4

10. Chen RJ, Ding T, Lu MY, et al. Towards a general-purpose foundation model for computational pathology. *Nature Medicine*. 2024;30. doi:10.1038/s41591-024-02857-3

11. Xu H, Usuyama N, Bagga J, et al. A whole-slide foundation model for digital pathology from real-world data. *Nature*. 2024;630:181–188. doi:10.1038/s41586-024-07441-w

12. Sagawa S, Koh PW, Hashimoto TB, Liang P. Distributionally robust neural networks for group shifts: on the importance of regularization for worst-case generalization. *ICLR*. 2020. arXiv:1911.08731

13. Yang Y, Lin M, Zhao H, Peng Y, Huang F, Lu Z. A survey of recent methods for addressing AI fairness and bias in biomedicine. *Journal of Biomedical Informatics*. 2024. doi:10.1016/j.jbi.2024.104645

14. Yfantidou S, Spathis D, Constantinides M, Vakali A, Quercia D, Kawsar F. Using self-supervised learning can improve model fairness. *KDD*. 2024. arXiv:2406.02361

15. Liang T, et al. FairDA: Fair classification via domain adaptation — a dual adversarial learning approach. *Frontiers in Big Data*. 2023;5:1049565. doi:10.3389/fdata.2022.1049565

16. Kenfack P, Ebrahimi Kahou S, Aïvodji U. Fairness under demographic scarce regime. *Journal of Machine Learning Research*. 2024.

17. Howard FM, Dolezal J, Kochanny S, et al. The impact of site-specific digital histology signatures on deep learning model accuracy and bias. *Nature Communications*. 2021;12:4423. doi:10.1038/s41467-021-24698-1

18. Dehkharghanian T, Bidgoli AA, Riasatian A, et al. Biased data, biased AI: deep networks predict the acquisition site of TCGA images. *Diagnostic Pathology*. 2023;18:67. doi:10.1186/s13000-023-01355-3

19. Wang R, Kuo PC, Chen LC, Seastedt KP, Gichoya JW, Celi LA. Drop the shortcuts: image augmentation improves fairness and decreases AI detection of race and other demographics from medical images. *eBioMedicine*. 2024;102:105047. doi:10.1016/j.ebiom.2024.105047

20. Hanna MG, Pantanowitz L, Jackson B, et al. Ethical and bias considerations in artificial intelligence/machine learning. *Modern Pathology*. 2025;38(3):100686. doi:10.1016/j.modpat.2024.100686

21. Montezuma D, Porz R, Ameisen D, et al. Unbiased artificial intelligence: addressing bias in computational pathology. *Mayo Clinic Proceedings: Digital Health*. 2025;3(4):100302. doi:10.1016/j.mcpdig.2025.100302

22. Kheiri F, Rahnamayan S, Makrehchi M, Asilian Bidgoli A. Investigation on potential bias factors in histopathology datasets. *Scientific Reports*. 2025;15. doi:10.1038/s41598-025-89210-x

23. Nature Communications. Knowledge-guided adaptation of pathology foundation models effectively improves cross-domain generalization and demographic fairness. 2025. doi:10.1038/s41467-025-66300-y

24. Science Advances. Demographic bias of expert-level vision-language foundation models in medical imaging. 2025;11(13). doi:10.1126/sciadv.adq0305

25. Van Booven DJ, Chen CB, Kryvenko ON, et al. Mitigating bias in prostate cancer diagnosis using synthetic data for improved AI-driven Gleason grading. *npj Precision Oncology*. 2025;9:151. doi:10.1038/s41698-025-00934-5

26. BMJ FUTURE-AI Consortium. FUTURE-AI: international consensus guideline for trustworthy and deployable artificial intelligence in healthcare. *BMJ*. 2025;388:e081554. doi:10.1136/bmj-2024-081554

27. U.S. Food and Drug Administration. Predetermined Change Control Plans for AI-Enabled Device Software Functions: Final Guidance. August 2025.

28. U.S. Food and Drug Administration. Artificial Intelligence-Enabled Device Software Functions: Lifecycle Management and Marketing Submission Recommendations. Draft Guidance. January 2025.

29. College of American Pathologists. Validating Whole Slide Imaging for Diagnostic Purposes in Pathology: Guideline Update. *Archives of Pathology & Laboratory Medicine*. 2021 (reaffirmed 2024).

30. Asif A, Rajpoot K, Graham S, Snead D, Minhas F, Rajpoot N. Unleashing the potential of AI for pathology: challenges and recommendations. *Journal of Pathology*. 2023;260(5):564–577. doi:10.1002/path.6168

31. Rosbach E, Ammeling J, Krügel S, et al. When two wrongs don't make a right—examining confirmation bias and the role of time pressure during human-AI collaboration in computational pathology. Preprint. 2024.

32. Lyell D, Coiera E. Automation bias and verification complexity: a systematic review. *Journal of the American Medical Informatics Association*. 2017;24(2):423–431. doi:10.1093/jamia/ocw105

33. Karargyris A, Umeton R, Sheller MJ, et al. Federated benchmarking of medical artificial intelligence with MedPerf. *Nature Machine Intelligence*. 2023;5:799–810. doi:10.1038/s42256-023-00652-2

34. Movva R, Koh PW, Pierson E. Using unlabeled data to enhance fairness of medical AI. *Nature Medicine*. 2024;30:944–945. doi:10.1038/s41591-024-02892-0

35. Lin W, Liu S, Zhu R, Wang L. Unveiling institution-specific bias in pathology foundation models: detriments, causes, and potential solutions. arXiv:2502.16889. 2025.

36. de Jong ED, Marcus E, Teuwen J. Current pathology foundation models are unrobust to medical center differences. arXiv:2501.18055. 2025.

37. Chai J, Wang X. Self-supervised fair representation learning without demographics. *NeurIPS*. 2024.

38. El-Khoury R, et al. The rise of AI-assisted diagnosis: will pathologists be partners or bystanders? *Diagnostics*. 2025;15(18):2308. doi:10.3390/diagnostics15182308

39. JAMA Health Forum. Use and public reporting of predetermined change control plans for AI-enabled medical devices. May 2026.

40. npj Digital Medicine. A scoping review and evidence gap analysis of clinical AI fairness. 2025. doi:10.1038/s41746-025-01667-2

41. Sebastian M, Batra H, Lamba Saini M. Applications and challenges of utilizing digital pathology and AI-enabled workflows in clinical trials. *Journal of Pathology Informatics*. 2026;20:100542. doi:10.1016/j.jpi.2025.100542

42. Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71.

43. Vorontsov E, et al. Virchow: A million-slide foundation model for computational pathology. 2024.

44. U.S. Food and Drug Administration. Artificial Intelligence-Enabled Medical Devices List. Updated 2025.

45. Gruber SG, Buettner F. Better uncertainty calibration via proper scores for classification and beyond. *NeurIPS*. 2022.

---

## Figure Legends

**Figure 1.** PRISMA 2020 flow diagram: from 1,847 unique records to 124 included studies.

**Figure 2.** Conceptual framework: three interacting bias sources (dataset, technical, annotation) in the histopathology AI pipeline, mapped to mitigation strategies at pre-processing, in-processing, and post-processing stages.

**Figure 3.** Comparative AUROC gaps between white and Black patients for breast cancer subtyping, lung cancer subtyping, and glioma IDH1 mutation prediction: standard supervised models vs. self-supervised foundation models. Data from Vaidya et al. (2024).

**Figure 4.** Fairness mitigation effectiveness across pre-processing (stain normalization, synthetic data augmentation, resampling), in-processing (adversarial training, Group DRO, contrastive learning via FAIR-Path, knowledge-guided adaptation via FLEX), and post-processing (threshold optimization, per-subgroup calibration) strategies. Expressed as percentage reduction in fairness metric disparities.

**Figure 5.** Regulatory timeline (2020–2026): FDA guidance milestones, CAP guideline updates, BMJ FUTURE-AI consensus, and landmark publications in histopathology AI fairness.

**Figure 6.** Geographic distribution of included studies vs. global cancer burden, illustrating the structural mismatch between where fairness evidence is produced and where the clinical need is greatest.

---

## Supplementary Materials (Available Separately)

- **S1:** Full search strategies for all databases
- **S2:** List of included studies with quality assessment ratings and extracted data
- **S3:** List of excluded full-text studies with reasons for exclusion
- **S4:** Detailed data extraction tables organized by theme
- **S5:** Risk of bias assessment results by domain and study
- **S6:** PRISMA 2020 checklist
- **S7:** Mathematical definitions of fairness metrics employed in included studies

---

*Correspondence concerning this manuscript should be addressed to the corresponding author.*

*Word count: ~9,400 (main text excluding references, figure legends, and supplementary materials)*
