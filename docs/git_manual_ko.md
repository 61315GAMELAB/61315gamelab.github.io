# Git 사용법

Git은 버전 관리 시스템으로, 파일의 변경 사항을 추적하고 여러 사람과 협업하는 데 사용됩니다. 이 문서는 Git의 기본적인 사용법을 안내합니다.

## 목차

- [Git 설치](#git-설치)
- [기본 설정](#기본-설정)
- [주요 명령어](#주요-명령어)
  - [git clone](#git-clone)
  - [git add](#git-add)
  - [git commit](#git-commit)
  - [git push](#git-push)
  - [git pull](#git-pull)
  - [git status](#git-status)
  - [git log](#git-log)

## Git 설치

[git-scm.com](https://git-scm.com/downloads)에서 운영체제에 맞는 Git을 다운로드하여 설치합니다.

## 기본 설정

Git을 설치한 후, 사용자 이름과 이메일 주소를 설정해야 합니다. 이 정보는 커밋에 기록됩니다.

```bash
git config --global user.name "Your Name"
git config --global user.email "youremail@example.com"
```

## 주요 명령어

### git clone

원격 저장소(repository)를 로컬 컴퓨터로 복제합니다.

```bash
git clone <repository_url>
```

### git add

작업 디렉토리의 변경 사항을 스테이징 영역(staging area)에 추가합니다.

```bash
# 특정 파일 추가
git add <file_name>

# 모든 변경 사항 추가
git add .
```

### git commit

스테이징 영역의 변경 사항을 로컬 저장소에 기록합니다.

```bash
git commit -m "커밋 메시지"
```
커밋 메시지는 변경 사항을 요약하는 중요한 정보이므로 명확하게 작성하는 것이 좋습니다.

### git push

로컬 저장소의 변경 사항을 원격 저장소에 업로드합니다.

```bash
git push origin <branch_name>
```

### git pull

원격 저장소의 변경 사항을 로컬 저장소로 가져와 병합합니다.

```bash
git pull origin <branch_name>
```

### git status

작업 디렉토리와 스테이징 영역의 상태를 보여줍니다. 어떤 파일이 변경되었는지, 어떤 파일이 스테이징되었는지 등을 확인할 수 있습니다.

```bash
git status
```

### git log

저장소의 커밋 히스토리를 보여줍니다.

```bash
git log
```
