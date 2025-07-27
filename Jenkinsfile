pipeline {
  agent any

  environment {
    DOCKERHUB_USER = 'rebelmitsui'
    IMAGE_NAME = 'backend'
    DOCKERHUB_PASSWORD = credentials('dockerhub-password')  // DockerHub token/password
  }

  stages {
    stage('Checkout Source') {
      steps {
        git url: 'https://github.com/ridwanhz/api-sample.git', branch: 'main'
      }
    }

    stage('Test') {
      steps {
        dir('backend') {
          sh 'npm install'
          sh 'npm test'
        }
      }
    }

    stage('Build & Push Docker Image') {
      steps {
        script {
          def commitHash = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
          env.IMAGE_TAG = commitHash

          sh "docker build -t $DOCKERHUB_USER/$IMAGE_NAME:$IMAGE_TAG ."
          sh "echo $DOCKERHUB_PASSWORD | docker login -u $DOCKERHUB_USER --password-stdin"
          sh "docker push $DOCKERHUB_USER/$IMAGE_NAME:$IMAGE_TAG"
        }
      }
    }

    stage('Update K8s Manifest & Push to manifest Branch') {
      steps {
        dir('k8s-manifest') {
          script {
            def newImage = "$DOCKERHUB_USER/$IMAGE_NAME:$IMAGE_TAG"

            // Fetch and checkout branch 'manifest'
            sh "git remote set-url origin https://github.com/ridwanhz/api-sample.git"
            sh "git fetch origin manifest"
            sh "git checkout manifest || git checkout -b manifest origin/manifest"

            // Get current image tag
            def currentImage = sh(
              script: "grep 'image:' 6-deployment.yaml | awk '{print \$2}'",
              returnStdout: true
            ).trim()

            if (currentImage != newImage) {
              echo "🔄 Updating image from $currentImage to $newImage"
              sh "sed -i 's|image: .*|image: $newImage|' 6-deployment.yaml"

              // Git config
              sh "git config user.email 'zkrhawafi5@gmail.com'"
              sh "git config user.name 'ridwanhz'"

              // Commit changes
              sh "git commit -am 'Update image to $IMAGE_TAG'"

              // Push to manifest branch with credentials
              withCredentials([usernamePassword(credentialsId: 'github-creds', usernameVariable: 'GIT_USER', passwordVariable: 'GIT_PASS')]) {
                sh 'git remote set-url origin https://${GIT_USER}:${GIT_PASS}@github.com/ridwanhz/api-sample.git'
                sh 'git push origin manifest'
              }
            } else {
              echo "✅ Image tag already up-to-date ($IMAGE_TAG), skipping push."
            }
          }
        }
      }
    }
  }
}
