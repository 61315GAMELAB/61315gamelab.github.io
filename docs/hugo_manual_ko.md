# Hugo 사용법

Hugo는 Go로 작성된 빠르고 유연한 정적 사이트 생성기입니다. 마크다운으로 콘텐츠를 작성하고, Hugo가 이를 웹사이트로 변환해줍니다.

## 목차

- [Hugo 설치](#hugo-설치)
- [주요 명령어](#주요-명령어)
  - [hugo new](#hugo-new)
  - [hugo server](#hugo-server)
  - [hugo](#hugo)
- [콘텐츠 구성](#콘텐츠-구성)
- [프론트 매터](#프론트-매터)

## Hugo 설치

[Hugo 공식 문서](https://gohugo.io/getting-started/installing/)를 참조하여 운영체제에 맞게 Hugo를 설치합니다. 이 프로젝트는 **확장(extended)** 버전을 사용해야 합니다.

이 프로젝트는 Hugo 버전 **0.141.0**을 사용합니다.

## 주요 명령어

### hugo new

새로운 콘텐츠 파일을 생성합니다.

```bash
hugo new <section>/<filename>.md
```
예를 들어, `post` 섹션에 새로운 글을 추가하려면 다음과 같이 실행합니다.
```bash
hugo new post/my-first-post.md
```

### hugo server

로컬 개발 서버를 실행하여 웹사이트를 미리 볼 수 있습니다.

```bash
hugo server
```
기본적으로 `http://localhost:1313/` 주소로 접속하여 확인할 수 있습니다. `-D` 또는 `--buildDrafts` 옵션을 추가하면 초안(draft) 상태인 콘텐츠도 함께 빌드하여 보여줍니다.

### hugo

웹사이트를 빌드합니다. `public` 디렉토리 안에 정적 파일들이 생성됩니다.

```bash
hugo
```

## 콘텐츠 구성

Hugo 프로젝트의 콘텐츠는 `content` 디렉토리 안에 구성됩니다. 각 하위 디렉토리는 웹사이트의 섹션이 됩니다.

예를 들어, `content/post` 디렉토리 안의 파일들은 'post' 섹션의 일부가 됩니다.

## 프론트 매터

모든 콘텐츠 파일의 시작 부분에는 **프론트 매터(Front Matter)**가 있어 해당 콘텐츠의 메타데이터를 정의합니다. YAML, TOML, JSON 형식을 지원합니다.

**YAML 예시:**
```yaml
---
title: "My First Post"
date: 2025-12-23T10:00:00+09:00
draft: true
tags: ["Hugo", "Web"]
---
```

- `title`: 콘텐츠의 제목
- `date`: 발행 날짜
- `draft`: `true`로 설정하면 초안 상태가 되어 `hugo` 명령 실행 시 빌드되지 않습니다.
- `tags`, `categories`: 콘텐츠를 분류하기 위한 태그나 카테고리
