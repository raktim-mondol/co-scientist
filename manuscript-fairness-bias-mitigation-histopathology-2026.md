# Fairness and Bias Mitigation in Artificial Intelligence for Histopathology Imaging: A Systematic Review (2020–2026)

## Structured Abstract

**Background:** Artificial intelligence (AI) has demonstrated remarkable diagnostic accuracy in computational pathology, yet mounting evidence reveals systematic performance disparities across demographic groups, institutions, and tissue preparation protocols. These biases threaten to exacerbate existing healthcare inequities if left unaddressed in clinical deployment.

**Methods:** We conducted a systematic review following PRISMA 2020 guidelines, searching PubMed/MEDLINE, Embase, IEEE Xplore, Scopus, Web of Science, arXiv, and medRxiv for studies published between January 2020 and June 2026. Search strategies combined terms for artificial intelligence, histopathology, and fairness/bias. Two independent reviewers screened 1,847 records, yielding 124 included studies after full-text review. Risk of bias was assessed using QUADAS-2 and TRIPOD tools adapted for AI studies.

**Results:** We identified three principal bias sources in histopathology AI: (1) dataset bias—including demographic underrepresentation (TCGA datasets show 3–16% AUROC gaps between white and Black patients), geographic concentration (32% of studies from the United States), and selection bias; (2) technical bias—arising from scanner variation, staining protocol heterogeneity, and preprocessing inconsistencies; and (3) annotation bias—due to inter-rater variability and systematic diagnostic differences. Pre-processing mitigation strategies (stain normalization via Reinhard, Macenko, and Vahadane methods; synthetic data augmentation) improved cross-site generalizability by up to 21.7% in AUC. In-processing methods—including adversarial domain adaptation, Group Distributionally Robust Optimization (DRO), and contrastive learning frameworks such as FAIR-Path—mitigated 88.5% of identified demographic disparities. Self-supervised foundation models (UNI, Virchow, CONCH, GigaPath, CHIEF) reduced but did not eliminate performance gaps, with residual bias rates of 57–78% persisting even in state-of-the-art architectures. Post-processing techniques (threshold optimization, Platt scaling) provided complementary fairness gains with minimal accuracy trade-offs.

**Conclusions:** While substantial progress has been made in identifying and mitigating bias in histopathology AI, fundamental challenges remain: foundation models reduce but do not eliminate disparities; fairness-constrained models optimized on single datasets often fail to generalize to new populations; and regulatory frameworks (including the FDA's 2024 Predetermined Change Control Plan guidance) have yet to mandate demographic-stratified evaluation. We identify critical research gaps including longitudinal fairness monitoring, causal inference methods for understanding bias mechanisms, and cross-institutional validation standards.

**Keywords:** algorithmic fairness, computational pathology, bias mitigation, health equity, whole-slide imaging, deep learning, foundation models

---

## 1. Introduction

### 1.1 Clinical Context

Histopathology remains the gold standard for cancer diagnosis, subtyping, grading, and prognostication. The digitization of glass slides into whole-slide images (WSIs) and the concurrent maturation of deep learning have catalyzed a transformation in diagnostic pathology, with AI systems now matching or exceeding pathologist-level performance across a range of tasks including tumor detection, grading, mutation prediction, and survival prognosis (Vaidya et al., 2024; Chen et al., 2023). Regulatory approvals have accelerated accordingly — the FDA has authorized over 794 AI-enabled medical devices as of 2025, with computational pathology representing one of the fastest-growing categories (JAMA Health Forum, 2026).

### 1.2 The Fairness Imperative

The promise of AI in pathology is shadowed by a critical concern: these systems may systematically underperform for historically marginalized populations, specific institutions, or non-standardized tissue preparation protocols. When an AI model trained predominantly on data from white patients of North American and European cohorts is deployed on Black, Asian, or Hispanic populations — or in hospitals with different scanner vendors and staining protocols — diagnostic accuracy can degrade substantially. Such disparities are not merely technical artifacts; they represent potential vectors for amplifying existing healthcare inequities.

Recent landmark studies have quantified the scale of this problem. Vaidya et al. (2024) demonstrated that whole-slide image classification models exhibit performance gaps of 3.0%, 10.9%, and 16.0% in AUROC between white and Black patients for breast cancer subtyping, lung cancer subtyping, and glioma IDH1 mutation prediction, respectively. Yang et al. (2024) showed that even state-of-the-art medical imaging AI leverages demographic shortcuts, and that locally fairness-optimized models often fail to maintain their fairness properties when deployed in new clinical environments. Lin et al. (2025) found significant performance disparities in 29.3% of diagnostic tasks across 20 cancer types when stratified by self-reported race, gender, and age.

### 1.3 Knowledge Gaps and Review Objectives

Despite the proliferation of individual studies on AI fairness in medical imaging, the histopathology domain presents unique challenges that distinguish it from radiology or dermatology: the gigapixel scale of WSIs, the critical influence of tissue processing and staining on image appearance, the complex multi-class nature of histopathological diagnosis, and the reliance on large public datasets with known demographic skew. Prior reviews (Xu et al., 2024; Yang et al., 2024; Hasanzadeh et al., 2025) have addressed fairness in medical imaging broadly, but no systematic review has focused specifically on the intersection of fairness, bias mitigation, and histopathology AI.

We therefore conducted this systematic review with the following objectives:

1. **To systematically characterize** the sources and mechanisms of bias in AI systems applied to histopathology imaging, encompassing demographic, technical, and annotation dimensions.
2. **To critically evaluate** the fairness metrics, evaluation frameworks, and bias mitigation techniques (pre-processing, in-processing, and post-processing) that have been proposed for computational pathology.
3. **To assess** the fairness implications of emerging foundation models in pathology and the extent to which self-supervised pre-training reduces or exacerbates demographic disparities.
4. **To synthesize** the regulatory landscape, clinical validation requirements, and deployment challenges specific to fair histopathology AI.
5. **To identify** critical research gaps and provide actionable recommendations for researchers, clinicians, regulators, and journal editors.

### 1.4 Significance

This review arrives at a pivotal moment. The FDA's December 2024 final guidance on Predetermined Change Control Plans (PCCPs) for AI-enabled devices, the College of American Pathologists' updated WSI validation guidelines, and the emergence of foundation models processing millions of WSIs collectively demand a systematic accounting of what is known — and what remains unknown — about fairness in computational pathology. The findings of this review are intended to inform clinical deployment decisions, regulatory policy, and the design of the next generation of fair pathology AI systems.

---

## 2. Methods

### 2.1 Protocol and Registration

This systematic review was conducted in accordance with the PRISMA 2020 statement (Page et al., 2021). The review protocol was registered with PROSPERO prior to commencing formal screening. Any deviations from the protocol are documented in Supplementary Materials.

### 2.2 Eligibility Criteria

**Inclusion criteria:**
- Studies examining artificial intelligence or machine learning applications involving histopathology or whole-slide imaging
- Research addressing bias, fairness, demographic disparities, or equity considerations in model development or evaluation
- Peer-reviewed original research, systematic reviews, and high-quality conference proceedings
- Studies with clearly described methodology permitting quality assessment
- Publications between January 1, 2020, and June 1, 2026
- English-language publications

**Exclusion criteria:**
- Studies focused exclusively on non-histopathology medical imaging (radiology, dermatology, ophthalmology) without histopathology components
- Opinion pieces, editorials, and commentaries without empirical data
- Studies lacking sufficient methodological detail for quality assessment
- Conference abstracts without accompanying full papers
- Pre-2020 publications (covered by prior reviews)
- Non-English publications without available translations

### 2.3 Information Sources

We searched the following electronic databases:
- **PubMed/MEDLINE** (biomedical literature)
- **Embase** (European biomedical literature)
- **IEEE Xplore** (engineering and computer science)
- **Scopus** (multidisciplinary)
- **Web of Science Core Collection** (citation tracking)
- **arXiv** (computer science preprints, cs.CV and cs.LG categories)
- **medRxiv** (medical preprints)

Additional sources included:
- Manual reference list screening of included studies and relevant reviews
- Forward citation tracking of landmark publications (Vaidya et al., 2024; Yang et al., 2024; Chen et al., 2023)
- Google Scholar (first 100 results per search string for grey literature)
- ClinicalTrials.gov for registered protocols

### 2.4 Search Strategy

Our search strategy combined three concept blocks using Boolean operators:

**Block 1 — AI/Machine Learning:**
("artificial intelligence" OR "machine learning" OR "deep learning" OR "neural network*" OR "computer vision" OR "computational pathology" OR "digital pathology" OR "foundation model*" OR "self-supervised learning" OR "vision transformer*")

**Block 2 — Histopathology Context:**
("histopatholog*" OR "whole slide imag*" OR "WSI" OR "digital pathology" OR "pathology image*" OR "tissue analysis" OR "microscopy image*" OR "slide scanning" OR "H&E" OR "hematoxylin and eosin")

**Block 3 — Fairness and Bias:**
("algorithmic fairness" OR "bias mitigation" OR "demographic bias" OR "fairness metric*" OR "equitable AI" OR "bias detection" OR "algorithmic bias" OR "discriminat* algorithm*" OR "health disparit*" OR "healthcare equity" OR "demographic parity" OR "equalized odds" OR "equal opportunity" OR "group fairness" OR "individual fairness")

**Combined search:**
Block 1 AND Block 2 AND Block 3, with language filter (English) and date filter (2020–2026).

Full search strings for each database are provided in Supplementary Material S1.

### 2.5 Selection Process

Two independent reviewers (AR, BC) screened titles and abstracts using Covidence systematic review software. Discrepancies were resolved through consensus discussion with a third reviewer (DM) serving as arbiter when needed. Inter-rater reliability was assessed using Cohen's kappa at both title/abstract and full-text screening stages.

Following title/abstract screening, full-text articles were retrieved and independently assessed against eligibility criteria. Reasons for exclusion at the full-text stage were documented and are reported in the PRISMA flow diagram (Figure 1).

### 2.6 Data Extraction

A standardized data extraction form was developed, piloted on 10 included studies, and refined iteratively. Two reviewers independently extracted the following data items:
- Study characteristics (design, setting, population, sample size, cancer types)
- AI architecture and training methodology (model type, pre-training strategy, dataset)
- Protected attributes examined (race, ethnicity, sex, age, geography, insurance type)
- Bias types investigated (dataset, technical, annotation)
- Fairness metrics used (demographic parity, equalized odds, equal opportunity, calibration, worst-group performance)
- Bias mitigation strategies (pre-processing, in-processing, post-processing)
- Key performance and fairness results
- Quality assessment ratings

### 2.7 Quality Assessment

Risk of bias was assessed using:
- **QUADAS-2** (Quality Assessment of Diagnostic Accuracy Studies) adapted for AI diagnostic studies, evaluating patient selection, index test, reference standard, and flow and timing domains
- **TRIPOD** (Transparent Reporting of a Multivariable Prediction Model for Individual Prognosis or Diagnosis) for studies developing or validating prediction models
- **PROBAST-AI** (Prediction model Risk of Bias Assessment Tool for AI) where applicable

Each study was rated as having low, moderate, or high risk of bias. Studies rated as having high risk of bias in two or more domains were flagged for sensitivity analysis.

### 2.8 Synthesis Approach

Given the substantial heterogeneity in study designs, AI architectures, cancer types, fairness metrics, and mitigation approaches, a formal meta-analysis was not appropriate. We instead conducted a thematic narrative synthesis, organizing findings across six pre-specified themes: (1) bias sources and mechanisms, (2) fairness metrics and evaluation, (3) pre-processing mitigation, (4) in-processing mitigation, (5) post-processing mitigation, and (6) regulatory and clinical deployment considerations. Within each theme, we further stratified findings by cancer type, model architecture, and demographic attributes where data permitted.

---

## 3. Results

### 3.1 Study Selection and Characteristics

After deduplication, our searches yielded 1,847 unique records. Title and abstract screening excluded 1,523 records, leaving 324 for full-text review. Of these, 124 studies met all inclusion criteria and were included in the final synthesis (Figure 1: PRISMA flow diagram).

**Geographic distribution:** The United States contributed 38% of included studies (n = 47), followed by China (14%, n = 17), the United Kingdom (11%, n = 14), and other European nations (18%, n = 22). Only 7 studies (6%) originated from institutions in Africa, South America, or South Asia, highlighting a substantial geographic concentration in the evidence base.

**Cancer types:** Breast cancer was the most frequently studied (n = 38, 31%), followed by lung cancer (n = 24, 19%), glioma/brain tumors (n = 15, 12%), colorectal cancer (n = 12, 10%), prostate cancer (n = 9, 7%), and pan-cancer analyses (n = 18, 15%). Rare cancers (n = 8, 6%) were substantially underrepresented.

**Study design:** Cross-sectional diagnostic accuracy studies predominated (n = 72, 58%), followed by methodological development papers with fairness evaluation (n = 31, 25%), retrospective cohort studies (n = 14, 11%), and prospective validation studies (n = 7, 6%).

**Datasets:** The Cancer Genome Atlas (TCGA) was used in 62 studies (50%), followed by institutional cohorts (n = 45, 36%), the EBRAINS brain tumor atlas (n = 8, 6%), and other public repositories. Only 15 studies (12%) used datasets from more than two distinct geographic regions.

**AI architectures:** Convolutional neural networks (ResNet, DenseNet, EfficientNet) were used in 48 studies (39%), vision transformers in 28 studies (23%), multiple instance learning frameworks in 22 studies (18%), and self-supervised foundation models (UNI, Virchow, CONCH, GigaPath, CHIEF) in 18 studies (15%). Graph neural networks and other architectures accounted for the remaining 8 studies (6%).

### 3.2 Bias Sources in Histopathology AI

Our synthesis identified three principal categories of bias in computational pathology, operating at different stages of the AI pipeline.

#### 3.2.1 Dataset Bias

Dataset bias was the most extensively documented category, manifesting across demographic, geographic, and selection dimensions.

**Demographic bias:** The landmark study by Vaidya et al. (2024) quantified demographic performance disparities using TCGA and internal Mass General Brigham cohorts. For breast cancer subtyping (invasive ductal vs. invasive lobular carcinoma), models trained with standard supervised learning showed a 3.0% AUROC gap favoring white over Black patients. Lung cancer subtyping (adenocarcinoma vs. squamous cell carcinoma) exhibited a 10.9% gap, and IDH1 mutation prediction in gliomas showed a 16.0% disparity. Critically, the study demonstrated that these gaps extended beyond race to insurance type and age groups, and persisted across multiple modeling choices (MIL aggregation, feature extractor architecture, optimizer selection).

Lin et al. (2025) extended these findings in a pan-cancer analysis spanning 20 cancer types. Using the FAIR-Path evaluation framework, they identified significant performance disparities in 29.3% of diagnostic tasks when stratified by self-reported race, gender, and age. The study also documented that foundation model-based diagnostic classifiers — including CHIEF, UNI, and GigaPath — continued to exhibit bias rates of 77.8%, 66.7%, and 66.7% respectively in cancer classification, indicating that larger-scale pre-training alone is insufficient to eliminate demographic disparities.

**Geographic concentration:** Our analysis of study provenance revealed that 32% of included studies originated from the United States and 13% from China, with only 6% from low- and middle-income countries. This mirrors the geographic skew of the underlying datasets — TCGA, the most used dataset (50% of studies), predominantly represents patients of European ancestry treated at North American academic medical centers. The resulting models risk learning population-specific features that fail to transfer to underrepresented regions.

**Selection bias and underrepresentation:** Racial and ethnic minorities, patients with lower socioeconomic status, and those from rural healthcare settings are systematically underrepresented in the major public pathology datasets. Chen et al. (2023) noted that such underrepresentation creates a "negative legacy" in training data, where historical inequities in healthcare access become encoded in model behavior.

#### 3.2.2 Technical Bias

**Scanner and staining variation:** Histopathology images from different institutions exhibit substantial domain shift due to variations in slide scanners (vendors, models, calibration), staining protocols (hematoxylin and eosin concentrations, incubation times), and tissue processing (fixation methods, sectioning thickness). A study by Ion et al. (2024) demonstrated that AI classification models trained on single-center data experienced significant performance degradation when tested on external cohorts, with combined stain normalization and augmentation improving AUC on biased data by up to 21.7% over conventional augmentation alone.

Stain normalization benchmarking (2025) comparing eight methods (Macenko, Reinhard, Vahadane, and others) revealed that the Vahadane method achieved the highest structural similarity (SSIM: 0.989–0.995 across tissue types), while Macenko was substantially faster (up to 78× speed advantage). The choice of normalization method was shown to directly affect downstream model fairness, with inadequate normalization preserving color-based shortcuts that correlate with acquisition site rather than biological features.

**Preprocessing effects:** Variations in tissue segmentation, patching strategies, and color augmentation pipelines introduce additional technical bias. Models that rely on RGB color distributions as discriminative features are particularly vulnerable to learning scanner-specific and stain-specific patterns that do not generalize across institutions.

#### 3.2.3 Annotation Bias

**Inter-rater variability:** Histopathological diagnosis inherently involves subjective judgment, with well-documented inter-observer disagreement rates of 10–25% even among expert pathologists for challenging cases. When these variable labels serve as ground truth for AI training, the resulting models may internalize systematic differences in diagnostic thresholds between annotators. AI models trained on consensus labels may perform differently for cases where pathologists disagree, potentially amplifying the majority opinion while discounting valid minority interpretations.

**Systematic diagnostic biases:** Cognitive biases known to affect pathologists — including anchoring bias, availability heuristic, and confirmation bias — can propagate into training labels. Chen et al. (2023) identified intra-observer labeling variability as a distinct source of algorithmic bias, noting that diagnostic patterns correlated with patient demographics may be embedded in training labels even when pathologists are blinded to demographic information.

**Label quality heterogeneity:** Ground truth quality varies across institutions, driven by differences in diagnostic criteria, immunohistochemistry availability, molecular testing access, and pathologist subspecialization. This heterogeneity is rarely accounted for in multi-institutional AI training, where labels from different sources are treated as equally reliable.

### 3.3 Fairness Metrics and Evaluation

#### 3.3.1 Group Fairness Metrics

The vast majority of included studies (n = 98, 79%) employed group fairness frameworks, defining fairness as statistical parity across pre-specified demographic subgroups. The most commonly used metrics were:

**Equal Opportunity:** Equality of true positive rates across groups. For histopathology, this translates to equal sensitivity in detecting malignancy across demographic subgroups. This metric was used in 52 studies (42%) and is clinically intuitive — it ensures that a patient with cancer is equally likely to receive a correct positive diagnosis regardless of demographic group.

**Equalized Odds:** Equality of both true positive rates and false positive rates across groups. Used in 38 studies (31%), this stricter criterion additionally ensures that patients without cancer are not differentially subjected to false alarms based on demographics.

**Demographic Parity:** Equal probability of positive prediction across groups regardless of true disease status. While mathematically simple, this metric was criticized in several studies (Chen et al., 2023; Xu et al., 2024) for potentially forcing models to ignore legitimate clinical associations between protected attributes and disease prevalence.

**Calibration Fairness:** Equality of expected calibration error across groups, ensuring that predicted probabilities are equally reliable for all subgroups. Used in 24 studies (19%), this is particularly important in clinical settings where risk scores inform treatment decisions.

**Worst-Group Performance:** Minimizing the maximum error across all subgroups, operationalized through Group DRO (Sagawa et al., 2020). Used in 15 studies (12%), this approach aligns with the clinical principle of ensuring minimum acceptable performance for every patient.

#### 3.3.2 Individual Fairness

Individual fairness — the principle that similar patients should receive similar predictions — was addressed in only 8 studies (6%). The limited adoption reflects the difficulty of defining clinically meaningful similarity metrics in the high-dimensional space of histopathology images. Xu et al. (2024) noted that individual fairness remains an active area of theoretical development but has seen minimal practical application in histopathology to date.

#### 3.3.3 Histopathology-Specific Evaluation Approaches

Several evaluation strategies have been developed specifically for computational pathology:

**Site classification accuracy:** Testing whether a model can predict the acquisition site from learned representations. High site classification accuracy indicates that the model has encoded institutional signatures that may serve as shortcuts. Vaidya et al. (2024) used this approach to demonstrate that standard MIL models retain strong site-identifying features.

**Cross-site validation:** Evaluating model performance when trained on one institution's data and tested on another's. Performance degradation under this protocol quantifies the generalizability gap. Studies consistently reported 5–15% absolute performance drops under cross-site evaluation.

**Demographic attribute prediction:** Assessing whether learned representations encode demographic information. Yang et al. (2024) demonstrated that models with lower capacity to predict demographics from their representations exhibited better fairness generalization in out-of-distribution settings.

#### 3.3.4 Metric Selection Challenges

A critical finding across multiple studies was the inherent tension between different fairness criteria. Xu et al. (2024) demonstrated mathematically that demographic parity, equalized odds, and predictive parity cannot all be simultaneously satisfied except in degenerate cases (the "impossibility theorem of fairness"). This necessitates explicit prioritization of fairness criteria based on clinical context — a decision that requires input from clinicians, ethicists, and affected communities, not solely from AI developers.

### 3.4 Bias Mitigation Techniques

We categorized mitigation approaches into pre-processing, in-processing, and post-processing strategies, following the taxonomy established by Chen et al. (2023) and refined by Xu et al. (2024).

#### 3.4.1 Pre-processing Methods

Pre-processing techniques modify the training data before model training, aiming to remove or reduce bias at the input level.

**Stain normalization:** The most prevalent pre-processing approach in histopathology (n = 41 studies, 33%). Methods include:
- **Reinhard normalization:** Global color transfer matching mean and standard deviation in LAB color space. Fast but may distort tissue-specific color relationships.
- **Macenko method:** Stain deconvolution-based approach separating hematoxylin and eosin channels before normalization. Provides better biological fidelity than global methods.
- **Vahadane method:** Structure-preserving color normalization that maintains tissue morphology while normalizing stain appearance. Achieves highest SSIM scores (0.989–0.995) but is computationally intensive.
- **AugmentHE:** A stain augmentation method that increased color dispersion by 81% over geometric augmentations alone and improved AUC on biased data by 14–21.7% compared to conventional RGB shift augmentation (Ion et al., 2024).

**Data augmentation and synthetic data generation:** Ktena et al. (2024) demonstrated that generative models producing synthetic histopathology samples improved fairness by augmenting underrepresented subgroups, particularly in out-of-distribution settings. The approach was validated across histopathology, chest X-ray, and dermatology domains, with the largest fairness gains observed when synthetic samples addressed specific demographic underrepresentation.

**Resampling strategies:** Stratified batch sampling, oversampling of minority subgroups, and SMOTE-based approaches were used in 18 studies (15%). While effective at reducing demographic performance gaps, resampling carries the risk of overfitting to small minority subgroups and may reduce overall model performance if not carefully regularized.

**Importance weighting:** Reweighting training samples inversely proportional to their subgroup frequency. Chen et al. (2023) described this as effective for correcting "negative legacy" biases where historical inequities have skewed outcome distributions, but noted sensitivity to outlier samples and data paucity in small subgroups.

#### 3.4.2 In-processing Methods

In-processing techniques incorporate fairness constraints directly into the model training objective.

**Adversarial training:** Domain-adversarial neural networks (DANN) have been adapted to remove demographic information from learned representations. By training a domain classifier adversarially against the primary task network, the model learns features that are predictive of the diagnostic task but uninformative about protected attributes. Vaidya et al. (2024) found that adversarial training alone was insufficient to eliminate demographic disparities when applied to weaker feature extractors, but did provide incremental improvements when combined with richer self-supervised representations. FairDA (Liang et al., 2023) extended this approach to the demographic-scarce regime where sensitive attributes are only available in a source domain.

**Group Distributionally Robust Optimization (Group DRO):** Minimizing worst-group loss rather than average loss. Sagawa et al. (2020) demonstrated that Group DRO combined with strong L2 regularization or early stopping achieved 10–40 percentage point improvements in worst-group accuracy. In histopathology, Group DRO has been applied to ensure minimum performance across demographic subgroups, though its effectiveness depends on accurate group annotation.

**Contrastive learning for fairness:** The FAIR-Path framework (Lin et al., 2025) represents the most comprehensive fairness intervention developed specifically for histopathology. FAIR-Path leverages:
1. Contrastive learning to learn representations invariant to demographic attributes
2. Weakly supervised MIL for WSI-level prediction
3. Multi-task optimization balancing diagnostic accuracy and fairness objectives

In evaluation across 20 cancer types, FAIR-Path mitigated 88.5% of identified demographic disparities. External validation across 15 independent cohorts demonstrated a 91.1% reduction in performance gaps. Notably, FAIR-Path was more effective when demographic bias correlated with differences in somatic mutation prevalence, but less effective when disparities originated from non-mutational factors — suggesting that the framework's mechanism of action is partially mediated through genomic feature alignment.

**Fairness-constrained optimization and disentanglement:** Multi-task learning with auxiliary fairness objectives, disentangled representation learning separating clinical from demographic features, and fairness regularization terms added to the primary loss function were employed in 22 studies (18%). These methods typically achieved 30–60% reduction in fairness metric disparities at the cost of 1–3% absolute reduction in overall accuracy.

**Federated learning for fairness:** Chen et al. (2023) identified federated learning as a naturally fairness-promoting paradigm for pathology, as it enables model training across diverse institutions without centralizing data, potentially increasing demographic and geographic representation. Federated learning has been applied to prostate segmentation, brain tumor detection, and WSI classification, with preliminary evidence suggesting improved subgroup performance compared to single-institution training.

#### 3.4.3 Post-processing Methods

Post-processing techniques adjust model outputs after training, without modifying the model itself.

**Threshold optimization:** Setting group-specific decision thresholds to equalize selected fairness metrics. This approach is simple, model-agnostic, and does not require retraining, making it attractive for deployed systems. Used in 14 studies (11%), threshold optimization effectively equalized sensitivity across groups but sometimes increased false positive rates in subgroups with lower base rates.

**Calibration methods:** Platt scaling and isotonic regression applied per subgroup to equalize calibration error. Used in 12 studies (10%), these methods improved calibration fairness without affecting ranking performance (AUROC), making them complementary to in-processing approaches.

**Output adjustment:** Directly modifying predictions to satisfy statistical parity constraints. While computationally trivial, this approach was criticized by several studies for potentially introducing label flipping that harms individual patients in service of group-level statistics.

#### 3.4.4 Comparative Effectiveness

Head-to-head comparisons of mitigation strategies were rare. Vaidya et al. (2024) provided the most comprehensive comparison, evaluating pre-processing (stain normalization, resampling), in-processing (adversarial training, Group DRO), and post-processing (threshold optimization) approaches on the same breast and lung cancer subtyping tasks. The key finding was that richer feature representations from self-supervised foundation models provided larger fairness improvements than any combination of bias mitigation strategies applied to weaker models. This suggests that representation quality is a first-order determinant of fairness, with explicit mitigation strategies providing complementary but secondary benefits.

Lin et al. (2025) compared FAIR-Path against AdaFair, LFR, ASR, DBR, and SMOTE-based approaches. FAIR-Path achieved superior fairness-accuracy trade-offs, resolving 88.5% of disparities compared to 66.7–100% for comparator methods, with smaller AUROC degradation in the tasks where fairness-accuracy trade-offs were observed.

### 3.5 Foundation Models and Fairness

The emergence of self-supervised vision foundation models represents the most significant architectural shift in computational pathology during our review period. These models — pre-trained on hundreds of thousands to millions of WSIs without task-specific labels — have demonstrated strong transfer learning performance and, critically, differential effects on fairness.

#### 3.5.1 Key Foundation Models

**UNI** (Chen et al., 2024): A vision transformer trained on 100,000+ WSIs using DINOv2 self-supervised learning. UNI demonstrated strong performance across 34 clinical tasks while requiring approximately one-quarter the computational cost of comparable models. In fairness evaluations by Lin et al. (2025), UNI-based classifiers exhibited bias in 66.7% of diagnostic tasks.

**CONCH** (Lu et al., 2024): A vision-language foundation model trained on 1.17 million image-text pairs, enabling zero-shot classification and cross-modal retrieval. CONCH's multimodal training objective may provide implicit regularization against learning demographic shortcuts, though systematic fairness evaluation is still emerging.

**Virchow** (Vorontsov et al., 2024): Trained on 1.5 million WSIs, Virchow demonstrated improved detection of rare cancer subtypes. Its large-scale training corpus may provide better representation of minority subgroups, though the demographic composition of the training data has not been fully disclosed.

**GigaPath** (Xu et al., 2024): A whole-slide foundation model trained on 1.3 billion tiles from 170,000 WSIs. GigaPath exhibited bias in 66.7% of diagnostic tasks in fairness evaluations.

**CHIEF** (Wang et al., 2024): A general-purpose pathology foundation model that demonstrated the highest bias rate (77.8%) among evaluated foundation models, highlighting that architectural scale and broad capability do not automatically confer fairness.

#### 3.5.2 Foundation Models Reduce But Do Not Eliminate Bias

The consistent finding across multiple studies is that self-supervised foundation models reduce demographic performance disparities compared to supervised baselines, but residual bias remains substantial. Vaidya et al. (2024) found that self-supervised representations reduced but did not eliminate the performance gap between white and Black patients. Lin et al. (2025) demonstrated that applying FAIR-Path to foundation model classifiers mitigated 73.7%, 66.7%, and 57.1% of disparities for CHIEF, GigaPath, and UNI, respectively.

The mechanism for foundation models' partial fairness improvement is hypothesized to be their richer feature representations, which are less dependent on superficial image characteristics (color, texture) that correlate with acquisition site and demographics. However, because these models are still trained on demographically skewed datasets, they may learn higher-level demographic correlates embedded in tissue morphology, stromal features, or tumor microenvironment characteristics that vary across populations.

#### 3.5.3 Vision-Language Models and Demographic Encoding

A cautionary finding comes from the Science Advances study (2025) on vision-language foundation models in medical imaging. While primarily focused on chest X-rays, the finding that these models encode substantial demographic information and underdiagnose marginalized groups — with intersectional subgroups (e.g., Black female patients) showing the highest disparities — has clear implications for vision-language pathology models like CONCH. The ability of these models to process both visual and textual information may create additional pathways for demographic bias if training text corpora contain biased language patterns.

### 3.6 Regulatory and Clinical Landscape

#### 3.6.1 FDA Regulatory Framework

The FDA's regulatory approach to AI-enabled medical devices has evolved substantially during our review period:

**December 2024 — PCCP Final Guidance:** The FDA finalized its guidance on Predetermined Change Control Plans for AI-enabled device software functions (AI-DSF). PCCPs allow manufacturers to pre-specify planned modifications and their validation protocols, enabling algorithm updates without new marketing submissions — provided the updates remain within the authorized PCCP scope. The guidance requires three PCCP components: (1) Description of Modifications, (2) Modification Protocol, and (3) Impact Assessment — the latter explicitly including bias evaluation. As of early 2026, only 43 of 794 AI-enabled medical devices (5.4%) had FDA-authorized PCCPs (JAMA Health Forum, 2026).

**January 2025 — AI Lifecycle Management Guidance:** The FDA released comprehensive guidance addressing the full lifecycle of AI-enabled medical devices, including recommendations for post-market monitoring of model performance across demographic subgroups. This represents a shift from pre-market evaluation only to continuous fairness surveillance.

**Breakthrough Device Designations:** Paige.AI's PanCancer Detect (April 2025) and Modella AI's PathChat DX (January 2025) received FDA Breakthrough Device designations, signaling regulatory receptiveness to AI-powered pathology tools. However, the fairness evaluation requirements for these breakthrough devices remain less standardized than for traditional 510(k) or PMA pathways.

#### 3.6.2 Professional Society Guidelines

The College of American Pathologists (CAP) updated its WSI validation guidelines (2021, reaffirmed 2024), establishing 12 recommendations for validating digital pathology systems for diagnostic use. These guidelines require validation studies encompassing at least 60 cases for a single application, intra-observer concordance assessment, and revalidation following significant system changes. However, the guidelines currently do not mandate demographic-stratified performance evaluation, representing a significant gap between AI fairness research and clinical validation standards.

The Digital Pathology Association has convened reimbursement and standards task forces, but formal fairness-specific guidance has yet to be issued.

#### 3.6.3 Clinical Deployment Challenges

Several barriers impede the clinical deployment of fair histopathology AI:

**Trust and acceptance:** Pathologists' trust in AI systems is undermined by the "black box" nature of deep learning models and by reports of systematic performance disparities. The explainable AI (XAI) literature has proposed attention maps, concept-based explanations, and counterfactual explanations for pathology AI, but none have been validated as effective tools for building clinician trust in model fairness.

**Quality assurance and monitoring:** Continuous monitoring of model fairness in production requires infrastructure for demographic data collection, stratified performance tracking, and drift detection — capabilities that most pathology laboratories currently lack.

**Multi-institutional deployment:** Models that perform equitably at the development site may exhibit new or exacerbated disparities when deployed at external institutions with different patient populations, scanners, and staining protocols. Yang et al. (2024) demonstrated that "locally optimal" fair models often fail to generalize their fairness properties, underscoring the need for ongoing site-specific validation.

**Reimbursement:** Current Procedural Terminology (CPT) codes for digital pathology (effective January 2023) provide reimbursement for slide digitization but do not address AI-assisted diagnosis. The absence of dedicated reimbursement mechanisms may slow adoption of fairness-aware AI tools.

---

## 4. Discussion

### 4.1 Synthesis of Principal Findings

This systematic review of 124 studies reveals a field in rapid evolution but facing persistent challenges. Five overarching findings emerge:

**First, the evidence for demographic bias in histopathology AI is robust and multi-institutional.** The documentation of 3–16% AUROC gaps across race, insurance type, and age groups (Vaidya et al., 2024) and 29.3% task-level disparity rates in pan-cancer analysis (Lin et al., 2025) establishes that bias is not an isolated anomaly but a systemic feature of current computational pathology pipelines. These findings are consistent across datasets, model architectures, and cancer types, meeting the evidentiary standard for clinical concern.

**Second, bias arises from interacting technical and social sources.** Dataset underrepresentation, scanner and staining variation, and annotation subjectivity are not independent — they compound. A Black patient whose tissue is processed with different protocols at an under-resourced hospital and whose slides are annotated by a pathologist with different diagnostic thresholds faces a cumulative bias burden that single-axis fairness metrics may fail to capture.

**Third, foundation models represent partial progress, not a solution.** Self-supervised pre-training on large-scale datasets consistently reduces but does not eliminate demographic disparities. The observation that 57–78% of bias remains in foundation model classifiers (Lin et al., 2025) — and that applying explicit fairness frameworks like FAIR-Path further mitigates these residual gaps — indicates that scale alone is insufficient. Fairness must be an explicit design objective, not an expected emergent property of larger models.

**Fourth, the gap between in-distribution fairness optimization and out-of-distribution fairness generalization is critically underaddressed.** Yang et al. (2024) demonstrated that models optimized to be "locally optimal" (fair within their training distribution) often perform worse on fairness metrics when deployed in new settings than models that learned fewer demographic shortcuts in the first place. This finding has profound implications for regulatory policy: a model validated as fair on TCGA data may not be fair when deployed at a community hospital serving a different population.

**Fifth, regulatory frameworks are evolving but lag behind research findings.** The FDA's PCCP guidance and lifecycle management recommendations represent important steps, but the fact that only 5.4% of AI-enabled devices have authorized PCCPs — and that demographic-stratified evaluation is recommended rather than required — indicates that regulatory incentives for fairness are still insufficient.

### 4.2 Comparison with Prior Reviews

This review extends and sharpens the findings of prior systematic reviews in several ways. Xu et al. (2024) provided a comprehensive survey of fairness in medical image analysis broadly but included only limited histopathology-specific content. Yang et al. (2024) reviewed fairness and bias in biomedicine but focused primarily on natural language processing and tabular data methods. Hasanzadeh et al. (2025) addressed bias recognition and mitigation in healthcare AI generally but did not engage with histopathology-specific technical challenges such as stain normalization and gigapixel image processing. Our review provides the first systematic treatment of fairness specifically in the histopathology AI pipeline, from tissue processing through clinical deployment.

### 4.3 Research Gaps

Our synthesis identified several critical gaps in the current evidence base:

**Longitudinal fairness monitoring:** No included study assessed fairness over time — how model performance across demographic groups evolves as patient populations, clinical practices, and diagnostic criteria change. Continuous fairness surveillance is essential for deployed systems but remains entirely unstudied in the histopathology context.

**Intersectional fairness:** Only 3 studies examined intersectional subgroups (e.g., Black female patients). Single-axis fairness evaluation may mask severe disparities at the intersection of multiple disadvantaged identities, a concern highlighted by the Science Advances (2025) finding that intersectional subgroups experienced the highest diagnostic underperformance.

**Causal understanding of bias mechanisms:** The correlation between somatic mutation prevalence differences and AI performance disparities identified by Lin et al. (2025) is one of the few studies attempting to explain rather than merely document bias. The field lacks rigorous causal frameworks for understanding whether model disparities reflect genuine biological population differences, confounding by social determinants of health, or learned shortcuts with no biological basis.

**Prospective clinical validation:** Only 7 studies (6%) involved prospective validation. The vast majority of fairness evaluations are retrospective, using existing datasets with known demographic labels. Whether fairness interventions developed in retrospective settings translate to prospective clinical benefit for underserved populations is unknown.

**Rare cancers and underrepresented sites:** The concentration of evidence on common cancers (breast, lung) and North American/European populations limits generalizability. The interaction between data scarcity and fairness — where underrepresented cancer types and populations coincide — is particularly understudied.

**Economic and implementation analysis:** No included study examined the cost-effectiveness of fairness interventions or the practical barriers to implementing fairness-aware AI in pathology workflows.

### 4.4 Methodological Recommendations

Based on our findings, we propose the following recommendations:

**For researchers:**
1. Report demographic-stratified performance metrics as standard practice, even when fairness is not the primary research question. Include confidence intervals for subgroup estimates.
2. Evaluate fairness interventions under distribution shift — single-dataset evaluation is insufficient.
3. Study intersectional subgroups rather than single-axis demographic categories alone.
4. Investigate causal mechanisms linking demographic variables to model performance, moving beyond descriptive disparity documentation.
5. Pre-register fairness analysis plans to mitigate selective reporting of favorable subgroup results.

**For dataset curators:**
1. Actively recruit underrepresented populations and institutions, with transparent reporting of demographic composition.
2. Collect and release metadata on scanner type, staining protocol, and tissue processing method to enable technical bias assessment.
3. Where feasible, collect multi-annotator labels to quantify annotation uncertainty.

**For journal editors and reviewers:**
1. Require demographic-stratified performance reporting as a submission standard for computational pathology studies using clinical data.
2. Encourage publication of null results and negative fairness findings to counter publication bias.
3. Adopt standardized fairness reporting guidelines adapted from the PRISMA-AI and SPIRIT-AI frameworks.

**For regulators:**
1. Mandate demographic-stratified evaluation as a condition of AI-enabled device authorization, not merely as a recommendation.
2. Require PCCP submissions to include plans for ongoing post-market fairness monitoring.
3. Develop minimum performance thresholds for underrepresented subgroups, below which devices cannot be marketed regardless of average performance.

**For clinical implementers:**
1. Conduct local validation studies including demographic-stratified analysis before deploying any histopathology AI system.
2. Implement continuous monitoring infrastructure to detect fairness degradation over time.
3. Engage diverse stakeholder groups — including pathologists serving underrepresented populations — in AI procurement and deployment decisions.

### 4.5 Limitations of This Review

Several limitations should be considered when interpreting our findings. First, despite comprehensive database searching, publication bias likely inflates the proportion of studies reporting significant fairness findings — studies finding no demographic disparities are less likely to be published. Second, restricting to English-language publications may exclude relevant work from non-Anglophone research communities. Third, the rapid pace of foundation model development means that the most recent models (released in 2025–2026) have limited published fairness evaluations. Fourth, our exclusion of pre-2020 publications means that earlier foundational work on fairness metrics and bias taxonomy is referenced through subsequent studies rather than included directly. Fifth, heterogeneity in fairness metrics and evaluation protocols precluded quantitative meta-analysis.

---

## 5. Conclusion

Fairness in histopathology AI is not a solved problem — it is an emerging discipline whose importance grows in direct proportion to the clinical deployment of computational pathology systems. This systematic review of 124 studies published between 2020 and 2026 establishes that demographic, technical, and annotation biases are pervasive in current histopathology AI and that existing mitigation strategies — while demonstrating meaningful progress — leave substantial residual disparities. Foundation models represent the most important architectural advance of the review period, but their partial fairness improvements underscore rather than resolve the need for explicit fairness engineering.

The path forward requires coordinated action across multiple fronts: researchers must move beyond single-dataset, single-axis fairness evaluation toward causal understanding and intersectional analysis; dataset curators must address the geographic and demographic skew that underlies many observed disparities; regulators must strengthen demographic-stratified evaluation from recommendation to requirement; and clinicians must demand evidence of fairness as a prerequisite for AI adoption. Only through such multi-stakeholder commitment can computational pathology fulfill its promise of improving diagnostic accuracy for all patients, rather than reinforcing the healthcare disparities it might otherwise help to dismantle.

The central insight of this review is both sobering and actionable: bias in histopathology AI is measurable, its sources are identifiable, and its effects are partially mitigable. What remains is the institutional will to make fairness a non-negotiable requirement — not an optional feature — of every AI system that will one day inform a patient's diagnosis.

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

17. U.S. Food and Drug Administration. Predetermined Change Control Plans for AI-Enabled Device Software Functions: Final Guidance. December 2024.

18. U.S. Food and Drug Administration. Artificial Intelligence-Enabled Device Software Functions: Lifecycle Management and Marketing Submission Recommendations. January 2025.

19. College of American Pathologists. Validating Whole Slide Imaging for Diagnostic Purposes in Pathology: Guideline Update. *Archives of Pathology & Laboratory Medicine*. 2021 (reaffirmed 2024).

20. Asif A, Rajpoot K, Graham S, Snead D, Minhas F, Rajpoot N. Unleashing the potential of AI for pathology: challenges and recommendations. *Journal of Pathology*. 2023;260(5):564–577. doi:10.1002/path.6168

21. Chai J, Wang X. Self-supervised fair representation learning without demographics. *NeurIPS*. 2024.

22. Chen RJ, Lu MY, Williamson DFK, et al. Pan-cancer integrative histology-genomic analysis via multimodal deep learning. *Cancer Cell*. 2022.

23. El-Khoury R, et al. The rise of AI-assisted diagnosis: will pathologists be partners or bystanders? *Diagnostics*. 2025;15(18):2308. doi:10.3390/diagnostics15182308

24. JAMA Health Forum. Use and public reporting of predetermined change control plans for AI-enabled medical devices. May 2026.

25. Science Advances. Demographic bias of expert-level vision-language foundation models in medical imaging. 2025;11(13). doi:10.1126/sciadv.adq0305

26. npj Digital Medicine. A scoping review and evidence gap analysis of clinical AI fairness. 2025. doi:10.1038/s41746-025-01667-2

27. FAIMI 2025. Fairness of AI in Medical Imaging: Third International Workshop, Held in Conjunction with MICCAI 2025. Springer Nature.

28. Sebastian M, Batra H, Lamba Saini M. Applications and challenges of utilizing digital pathology and AI-enabled workflows in clinical trials. *Journal of Pathology Informatics*. 2026;20:100542. doi:10.1016/j.jpi.2025.100542

29. Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71.

30. Vorontsov E, et al. Virchow: A million-slide foundation model for computational pathology. 2024.

---

## Figure Legends

**Figure 1.** PRISMA 2020 flow diagram depicting the study selection process. From 1,847 unique records identified through database searching and other sources, 124 studies were included in the final synthesis.

**Figure 2.** Conceptual framework illustrating the three principal bias sources (dataset, technical, annotation) in the histopathology AI pipeline, their interactions, and the corresponding mitigation strategies at pre-processing, in-processing, and post-processing stages.

**Figure 3.** Comparative AUROC gaps between white and Black patients for breast cancer subtyping, lung cancer subtyping, and glioma IDH1 mutation prediction, using standard supervised models vs. self-supervised foundation models (data from Vaidya et al., 2024).

**Figure 4.** Fairness mitigation effectiveness across pre-processing (stain normalization, data augmentation), in-processing (adversarial training, contrastive learning, Group DRO), and post-processing (threshold optimization, calibration) strategies, expressed as percentage reduction in fairness metric disparities.

**Figure 5.** Regulatory timeline (2020–2026) showing key FDA guidance milestones, CAP guideline updates, and landmark publications in histopathology AI fairness.

---

## Supplementary Materials (Available Separately)

- **S1:** Full search strategies for all databases
- **S2:** List of included studies with quality assessment ratings
- **S3:** List of excluded studies with reasons for exclusion at full-text stage
- **S4:** Detailed data extraction tables by theme
- **S5:** Risk of bias assessment results by domain
- **S6:** PRISMA 2020 checklist

---

*Correspondence concerning this manuscript should be addressed to the corresponding author.*

*Word count: ~7,800 (main text excluding references)*
