# 마크다운(Markdown) 문법 설명서

마크다운은 일반 텍스트 기반의 경량 마크업 언어입니다. 특별한 서식이 있는 문서를 쉽게 작성하고, HTML 등 다른 형태로 변환할 수 있습니다. 웹사이트 콘텐츠를 작성할 때 가장 널리 사용되는 문법 중 하나입니다.

## 목차

- [제목 (Headers)](#제목-headers)
- [문단 (Paragraphs)](#문단-paragraphs)
- [줄바꿈 (Line Breaks)](#줄바꿈-line-breaks)
- [텍스트 강조 (Emphasis)](#텍스트-강조-emphasis)
- [목록 (Lists)](#목록-lists)
  - [순서 없는 목록 (Unordered Lists)](#순서-없는-목록-unordered-lists)
  - [순서 있는 목록 (Ordered Lists)](#순서-있는-목록-ordered-lists)
- [링크 (Links)](#링크-links)
- [이미지 (Images)](#이미지-images)
- [인용문 (Blockquotes)](#인용문-blockquotes)
- [코드 (Code)](#코드-code)
  - [인라인 코드 (Inline Code)](#인라인-코드-inline-code)
  - [코드 블록 (Code Blocks)](#코드-블록-code-blocks)
- [수평선 (Horizontal Rules)](#수평선-horizontal-rules)
- [표 (Tables)](#표-tables)

---

## 제목 (Headers)

`#`의 개수로 제목의 수준을 표현합니다. `#`은 1개부터 6개까지 사용할 수 있습니다.

```markdown
# 이것은 H1 제목입니다
## 이것은 H2 제목입니다
### 이것은 H3 제목입니다
```

## 문단 (Paragraphs)

문단은 하나 이상의 연속된 텍스트 줄로 구성됩니다. 문단과 문단 사이는 빈 줄로 구분합니다.

```markdown
이것은 첫 번째 문단입니다.

이것은 두 번째 문단입니다.
```

## 줄바꿈 (Line Breaks)

문단 내에서 줄바금을 하려면, 줄 끝에 공백 두 개(`  `)를 입력하거나, `<br>` 태그를 사용합니다.

```markdown
첫 번째 줄입니다.  
이어서 두 번째 줄입니다.
```

## 텍스트 강조 (Emphasis)

-   **굵게 (Bold)**: 별표(`**`) 또는 언더스코어(`__`) 두 개로 텍스트를 감쌉니다.
    ```markdown
    **이 텍스트는 굵게 표시됩니다.**
    __이 텍스트도 굵게 표시됩니다.__
    ```
-   *기울임 (Italic)*: 별표(`*`) 또는 언더스코어(`_`) 한 개로 텍스트를 감쌉니다.
    ```markdown
    *이 텍스트는 기울임꼴입니다.*
    _이 텍스트도 기울임꼴입니다._
    ```
-   ~~취소선 (Strikethrough)~~: 물결표(`~~`) 두 개로 텍스트를 감쌉니다.
    ```markdown
    ~~이 텍스트는 취소선이 적용됩니다.~~
    ```

## 목록 (Lists)

### 순서 없는 목록 (Unordered Lists)

별표(`*`), 플러스 기호(`+`), 또는 하이픈(`-`)을 사용하여 순서 없는 목록을 만듭니다.

```markdown
* 항목 1
* 항목 2
  * 중첩된 항목 2.1
  * 중첩된 항목 2.2
```

### 순서 있는 목록 (Ordered Lists)

숫자와 점(`.`)을 사용하여 순서 있는 목록을 만듭니다. 숫자를 순서대로 입력하지 않아도 자동으로 번호가 매겨집니다.

```markdown
1. 첫 번째 항목
2. 두 번째 항목
3. 세 번째 항목
```

## 링크 (Links)

`[링크 텍스트](URL)` 형식으로 링크를 생성합니다.

```markdown
[Google](https://www.google.com)
```

## 이미지 (Images)

`![대체 텍스트](이미지_URL)` 형식으로 이미지를 삽입합니다. 링크와 비슷하지만 맨 앞에 느낌표(`!`)가 붙습니다.

```markdown
![Hugo 로고](https://gohugo.io/img/hugo.png)
```

## 인용문 (Blockquotes)

`>` 기호를 사용하여 인용문을 만듭니다.

```markdown
> 이것은 인용문입니다.
>
> > 이것은 중첩된 인용문입니다.
```

## 코드 (Code)

### 인라인 코드 (Inline Code)

백틱(`` ` ``)으로 텍스트를 감싸 인라인 코드를 표현합니다.

```markdown
`console.log("Hello, World!");`와 같이 사용합니다.
```

### 코드 블록 (Code Blocks)

백틱 세 개(```` ``` ````) 또는 물결표 세 개(`~~~`)로 코드 블록을 감쌉니다. 첫 번째 ``` 옆에 언어 이름을 명시하면 구문 강조(syntax highlighting)가 적용될 수 있습니다.

````markdown
```javascript
function sayHello() {
  console.log("Hello, World!");
}
```
````

## 수평선 (Horizontal Rules)

하이픈(`-`), 별표(`*`), 또는 언더스코어(`_`)를 세 개 이상 연속으로 입력하여 수평선을 만듭니다.

```markdown
---
***
___
```

## 표 (Tables)

파이프(`|`)와 하이픈(`-`)을 사용하여 표를 만듭니다. 헤더와 본문을 구분하는 라인에 콜론(`:`)을 사용하여 정렬을 지정할 수 있습니다.

```markdown
| 제목 1 | 제목 2 | 제목 3 |
| :--- | :---: | ---: |
| 왼쪽 정렬 | 가운데 정렬 | 오른쪽 정렬 |
| 내용 1 | 내용 2 | 내용 3 |
```
